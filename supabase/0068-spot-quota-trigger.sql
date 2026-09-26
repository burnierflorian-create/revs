-- ─────────────── Plafond de publication de spots, appliqué en base ───────────────
--
-- Jusqu'ici la limite de spots par jour n'était appliquée qu'à deux endroits,
-- tous deux contournables ou partiels :
--   1. src/pages/NewSpot.tsx — dans le NAVIGATEUR. Un INSERT direct via
--      PostgREST avec le jeton de l'utilisateur l'ignore complètement.
--   2. server/ai-gate.js — refuse le SCAN quand le quota de publication est
--      atteint. Efficace, mais il ne protège que le chemin qui passe par l'IA :
--      rien n'empêche d'insérer des spots sans jamais scanner.
--
-- Ce trigger est la dernière ligne : il vit dans la base, donc AUCUN chemin
-- d'écriture ne le contourne, pas même un client forgé.
--
-- Apply: node scripts/apply-rls.mjs supabase/0068-spot-quota-trigger.sql

-- ─────────── Quotas ───────────
-- Réplique volontaire de DAILY_LIMITS dans server/ai-gate.js, qui fait foi :
--   free / starter  5  ·  premium  30  ·  vip  300
-- Si l'un change, changer l'autre. Exposé en fonction pour qu'un seul endroit
-- de ce fichier porte les valeurs.
create or replace function public.spot_daily_limit(p_tier text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_tier, 'free'))
    when 'vip'     then 300
    when 'premium' then 30
    else 5              -- free, starter, et tout tier inconnu
  end;
$$;

-- ─────────── Trigger ───────────
create or replace function public.enforce_spot_daily_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz;
  v_tier      text;
  v_limit     integer;
  v_count     integer;
begin
  -- `created_at` est FORCÉ à maintenant. Sans cela le plafond serait
  -- trivialement contournable : la politique RLS n'interdit pas à un client de
  -- fournir sa propre valeur, et il suffirait d'antidater les insertions pour
  -- sortir de la fenêtre de comptage.
  new.created_at := now();

  -- Début de journée en heure de Paris, pas en UTC — même borne que
  -- parisDayStart() côté serveur et côté client, pour que les trois compteurs
  -- basculent au même instant.
  v_day_start := date_trunc('day', now() at time zone 'Europe/Paris')
                   at time zone 'Europe/Paris';

  -- Tier dérivé de l'abonnement Stripe (migration 0015), jamais de
  -- profiles.tier qui n'est jamais écrit.
  begin
    v_tier := public.user_tier(new.user_id);
  exception when others then
    -- Tier illisible → on retombe sur le plafond gratuit. Restrictif, donc
    -- sans danger : un abonné verra une limite basse plutôt qu'un accès
    -- illimité accordé par erreur.
    v_tier := null;
  end;
  v_limit := public.spot_daily_limit(v_tier);

  select count(*) into v_count
    from public.spots s
   where s.user_id = new.user_id
     and s.created_at >= v_day_start;

  if v_count >= v_limit then
    -- Journalisation de la tentative.
    --
    -- Volontairement un RAISE WARNING et PAS une insertion dans
    -- api_abuse_attempts : le RAISE EXCEPTION qui suit annule la transaction,
    -- donc toute ligne écrite ici serait annulée avec elle. Un avertissement
    -- part en revanche dans les logs Postgres et y reste consultable
    -- (Supabase → Logs → Postgres).
    raise warning
      '[spot-quota] user=% tier=% publiés=% limite=% — insertion refusée',
      new.user_id, coalesce(v_tier, 'free'), v_count, v_limit;

    raise exception
      'Limite de % spots par jour atteinte pour le palier %. Réessaie demain.',
      v_limit, coalesce(v_tier, 'free')
      using errcode = 'check_violation',
            hint = 'spot_daily_quota_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_spot_daily_quota on public.spots;
create trigger trg_enforce_spot_daily_quota
  before insert on public.spots
  for each row execute function public.enforce_spot_daily_quota();

-- Le trigger doit rester non appelable directement depuis le client.
revoke all on function public.enforce_spot_daily_quota() from anon, authenticated;
grant execute on function public.spot_daily_limit(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ─────────── Notes d'application ───────────
--
-- 1. Le trigger s'applique AUSSI aux écritures en service_role : les triggers
--    ne sont pas contournés par le rôle, contrairement à RLS. Aucun script du
--    dépôt n'insère dans `spots` (vérifié le 26/09/2026), donc rien ne casse.
--    Si un import administratif devient nécessaire, ajouter une exemption
--    explicite plutôt que de désactiver le trigger.
--
-- 2. `created_at` étant désormais forcé, une reprise de données qui voudrait
--    conserver les dates d'origine devra désactiver le trigger le temps de
--    l'opération.
--
-- 3. Message d'erreur : PostgREST renvoie un 400 avec le texte ci-dessus.
--    `hint = 'spot_daily_quota_exceeded'` permet au client de distinguer ce cas
--    d'une autre violation de contrainte sans analyser la chaîne française.
--    NewSpot.tsx affiche déjà l'erreur Supabase telle quelle via supaError().
