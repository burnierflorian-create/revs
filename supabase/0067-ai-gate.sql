-- ─────────────────────── Portail IA : auth + quota + audit ───────────────────────
-- Suite du diagnostic du 25/09/2026 : /api/detect-plate et /api/identify-car
-- acceptaient des appels Claude sans authentification (fail-open assumé).
-- Cette migration pose les trois pièces côté base :
--   1. ai_usage devient un compteur PAR ENDPOINT (et plus seulement par jour)
--   2. ai_gate_consume() : cooldown + quota + incrément, atomiques
--   3. api_abuse_attempts : journal des 401/429, purgé à 30 jours
--
-- Apply: node scripts/apply-rls.mjs supabase/0067-ai-gate.sql

-- ─────────── 1. ai_usage : une ligne par (user, jour, endpoint) ───────────
-- L'ancienne clé (user_id, day) mélangeait les deux endpoints. Or NewSpot
-- appelle identify-car ET detect-plate EN PARALLÈLE pour une seule capture :
-- sur un compteur partagé, le quota gratuit tombait de 6 captures à 3, et le
-- cooldown de 3 s faisait systématiquement échouer le second des deux appels
-- simultanés. Une ligne par endpoint règle les deux problèmes.
alter table public.ai_usage
  add column if not exists endpoint text not null default 'identify-car';

alter table public.ai_usage drop constraint if exists ai_usage_pkey;
alter table public.ai_usage
  add constraint ai_usage_pkey primary key (user_id, day, endpoint);

-- RLS déjà activé en 0064, volontairement SANS policy : la table n'est
-- accessible qu'au service_role. On le réaffirme ici par sécurité.
alter table public.ai_usage enable row level security;

-- ─────────── 2. Portail atomique : cooldown + quota + incrément ───────────
-- Tout se joue dans un seul aller-retour, sous verrou de ligne, pour qu'un
-- utilisateur ne puisse pas doubler son quota en tirant deux requêtes
-- concurrentes (l'ancien code lisait puis écrivait en deux temps).
--
-- Retourne (allowed, reason, used) :
--   allowed=false, reason='cooldown'        → 429, trop rapproché
--   allowed=false, reason='quota_exceeded'  → 429, plafond du jour atteint
--   allowed=true,  reason=null              → appel autorisé, compteur incrémenté
create or replace function public.ai_gate_consume(
  p_user        uuid,
  p_endpoint    text,
  p_day         date,
  p_limit       integer,
  p_cooldown_ms integer
)
returns table (allowed boolean, reason text, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_last  timestamptz;
begin
  select u.count, u.last_at
    into v_count, v_last
    from public.ai_usage u
   where u.user_id = p_user
     and u.day = p_day
     and u.endpoint = p_endpoint
   for update;

  if not found then
    v_count := 0;
    v_last := null;
  end if;

  if v_last is not null
     and now() - v_last < make_interval(secs => p_cooldown_ms / 1000.0) then
    return query select false, 'cooldown'::text, v_count;
    return;
  end if;

  if v_count >= p_limit then
    return query select false, 'quota_exceeded'::text, v_count;
    return;
  end if;

  insert into public.ai_usage (user_id, day, endpoint, count, last_at)
  values (p_user, p_day, p_endpoint, 1, now())
  on conflict (user_id, day, endpoint)
  do update set count = public.ai_usage.count + 1, last_at = now();

  return query select true, null::text, v_count + 1;
end;
$$;

-- Service-role uniquement : jamais appelable depuis le client, sinon un
-- utilisateur pourrait consommer le quota d'un autre en passant son uuid.
revoke all on function public.ai_gate_consume(uuid, text, date, integer, integer)
  from anon, authenticated;

-- ─────────── 3. Journal des tentatives refusées ───────────
-- Aucune donnée personnelle en clair : l'IP est hachée côté serveur
-- (SHA-256 + sel), l'user-agent est tronqué. Sert à repérer un scan ou un
-- bruteforce, pas à profiler un utilisateur.
create table if not exists public.api_abuse_attempts (
  id         bigserial primary key,
  endpoint   text not null,
  ip_hash    text,
  user_agent text,
  reason     text not null,
  created_at timestamptz not null default now()
);

create index if not exists api_abuse_attempts_created_at_idx
  on public.api_abuse_attempts (created_at desc);
create index if not exists api_abuse_attempts_ip_hash_idx
  on public.api_abuse_attempts (ip_hash, created_at desc)
  where ip_hash is not null;

-- RLS activé sans policy → lecture/écriture service_role exclusivement.
alter table public.api_abuse_attempts enable row level security;

-- Écriture + purge glissante à 30 jours. La purge est opportuniste (~1 appel
-- sur 100) plutôt que confiée à un cron : la table ne se remplit que sur
-- refus, et cela évite d'ajouter une tâche planifiée pour si peu.
create or replace function public.log_api_abuse(
  p_endpoint   text,
  p_ip_hash    text,
  p_user_agent text,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.api_abuse_attempts (endpoint, ip_hash, user_agent, reason)
  values (p_endpoint, p_ip_hash, left(coalesce(p_user_agent, ''), 300), p_reason);

  if random() < 0.01 then
    delete from public.api_abuse_attempts
     where created_at < now() - interval '30 days';
  end if;
end;
$$;

revoke all on function public.log_api_abuse(text, text, text, text)
  from anon, authenticated;

notify pgrst, 'reload schema';
