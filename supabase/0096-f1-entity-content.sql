-- ═══════ F1 — SÉPARER L'ÉDITORIAL DU SPORTIF ═══════
--
-- ── CE QUE L'AUDIT A TROUVÉ ──
-- `f1_teams` (10) et `f1_drivers` (20) cachaient déjà le contenu généré par
-- Claude. Le principe était bon. Le défaut était dans le MÉLANGE : un seul
-- blob `data` contenait à la fois
--
--   ce qui ne change JAMAIS            ce qui change à chaque course
--   ─────────────────────────────      ─────────────────────────────
--   bio, birthDate, birthPlace         currentPoints, currentPosition
--   fullName, nationality              seasonWins, seasonPodiums
--   history, foundedYear, base         seasonPoles, lastFiveGps
--   drivingStyle, highlights           lastRaceGp, lastRaceResults
--
-- …et `TTL_MS = 7 jours` s'appliquait à l'ensemble. Conséquence : tous les
-- sept jours, le PREMIER UTILISATEUR qui ouvrait la fiche d'un pilote
-- déclenchait une régénération complète avec recherche web — y compris sa
-- date de naissance. Trente entités, une réécriture hebdomadaire chacune,
-- pour des faits qui ne bougeront jamais.
--
-- C'est exactement ce que le cahier des charges interdit : « NE PAS
-- régénérer toute la biographie simplement parce qu'un GP vient de se
-- terminer ».
--
-- ── CE QU'ON FAIT ──
-- L'éditorial déménage ici, SANS DATE D'EXPIRATION. `f1_teams` et
-- `f1_drivers` gardent le sportif et leur TTL — eux doivent bien bouger.
--
-- ── ET ON NE PAIE RIEN POUR LA BASCULE ──
-- Les 30 fiches contiennent DÉJÀ le texte éditorial, payé il y a des
-- semaines. On l'extrait du jsonb existant. Zéro appel IA pour migrer.

create table if not exists public.f1_entity_content (
  entity_type     text not null check (entity_type in ('driver', 'team', 'circuit')),
  entity_key      text not null,
  lang            text not null default 'fr',
  /** Le contenu éditorial, structuré par type d'entité. */
  content         jsonb not null default '{}'::jsonb,
  content_version int  not null default 1,
  -- 'pending' est le verrou : il existe pendant la génération et empêche la
  -- seconde. Même mécanisme que `claim_brand_content` (migration 0095), qui
  -- a fait ses preuves : 5 ouvertures simultanées → 1 seule génération.
  status          text not null default 'ready'
                  check (status in ('pending', 'ready', 'failed')),
  claimed_at      timestamptz,
  generated_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (entity_type, entity_key, lang)
);

-- Lecture publique : c'est du contenu éditorial, pas une donnée personnelle.
-- Écriture réservée à la clé de service — la génération coûte de l'argent.
alter table public.f1_entity_content enable row level security;
drop policy if exists "f1 content public read" on public.f1_entity_content;
create policy "f1 content public read"
  on public.f1_entity_content for select using (true);
revoke insert, update, delete on public.f1_entity_content from authenticated, anon;

-- ─────────────── LE VERROU ───────────────
create or replace function public.claim_f1_content(
  p_type    text,
  p_key     text,
  p_lang    text,
  p_version int default 1
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_got boolean := false;
begin
  if exists (
    select 1 from public.f1_entity_content
     where entity_type = p_type and entity_key = p_key and lang = p_lang
       and status = 'ready' and content_version >= p_version
  ) then
    return 'ready';
  end if;

  insert into public.f1_entity_content (entity_type, entity_key, lang, status, claimed_at, content_version)
  values (p_type, p_key, p_lang, 'pending', now(), p_version)
  on conflict (entity_type, entity_key, lang) do update
     set status = 'pending', claimed_at = now()
   where f1_entity_content.status <> 'pending'
      -- Un verrou abandonné (fonction expirée, processus tué) condamnerait
      -- l'entité à ne jamais être générée. Deux minutes, puis reprenable.
      or f1_entity_content.claimed_at < now() - interval '2 minutes';

  get diagnostics v_got = row_count;
  return case when v_got then 'claimed' else 'pending' end;
end
$$;

grant execute on function public.claim_f1_content(text, text, text, int) to authenticated, anon;

-- Lecture, avec repli sur le français quand l'anglais n'existe pas encore :
-- mieux vaut une fiche lisible dans l'autre langue qu'un écran vide.
create or replace function public.f1_content(p_type text, p_key text, p_lang text default 'fr')
returns jsonb
language sql
stable
as $$
  select coalesce(
    (select content from public.f1_entity_content
      where entity_type = p_type and entity_key = p_key and lang = p_lang and status = 'ready'),
    (select content from public.f1_entity_content
      where entity_type = p_type and entity_key = p_key and lang = 'fr' and status = 'ready')
  )
$$;

grant execute on function public.f1_content(text, text, text) to authenticated, anon;

-- ─────────────── BASCULE DES 30 FICHES EXISTANTES ───────────────
-- Le texte est déjà là, déjà payé. On le déplace, on ne le régénère pas.
--
-- `where not exists` : la migration est rejouable sans écraser un contenu
-- plus récent qui aurait été généré entre-temps.

insert into public.f1_entity_content (entity_type, entity_key, lang, content, generated_at, status)
select
  'driver', d.slug, 'fr',
  jsonb_strip_nulls(jsonb_build_object(
    'fullName',      d.data -> 'fullName',
    'birthDate',     d.data -> 'birthDate',
    'birthPlace',    d.data -> 'birthPlace',
    'nationality',   d.data -> 'nationality',
    'bio',           d.data -> 'bio',
    'highlights',    d.data -> 'highlights',
    'drivingStyle',  d.data -> 'drivingStyle',
    -- Palmarès de CARRIÈRE : il n'évolue qu'après une victoire, et le
    -- rafraîchissement sportif le remet à jour. Il est copié ici pour que la
    -- fiche reste complète même si le volet dynamique n'a pas encore tourné.
    'championships', d.data -> 'championships',
    'wins',          d.data -> 'wins',
    'poles',         d.data -> 'poles',
    'podiums',       d.data -> 'podiums',
    'careerPoints',  d.data -> 'careerPoints'
  )),
  coalesce(d.generated_at, now()),
  'ready'
from public.f1_drivers d
where d.data is not null
  and not exists (
    select 1 from public.f1_entity_content c
     where c.entity_type = 'driver' and c.entity_key = d.slug and c.lang = 'fr'
  );

insert into public.f1_entity_content (entity_type, entity_key, lang, content, generated_at, status)
select
  'team', t.slug, 'fr',
  jsonb_strip_nulls(jsonb_build_object(
    'fullName',      t.data -> 'fullName',
    'shortName',     t.data -> 'shortName',
    'nationality',   t.data -> 'nationality',
    'base',          t.data -> 'base',
    'foundedYear',   t.data -> 'foundedYear',
    'history',       t.data -> 'history',
    'highlights',    t.data -> 'highlights',
    'carName',       t.data -> 'carName',
    'engine',        t.data -> 'engine',
    'specs',         t.data -> 'specs',
    'championships', t.data -> 'championships',
    'totalWins',     t.data -> 'totalWins',
    'totalPoles',    t.data -> 'totalPoles'
  )),
  coalesce(t.generated_at, now()),
  'ready'
from public.f1_teams t
where t.data is not null
  and not exists (
    select 1 from public.f1_entity_content c
     where c.entity_type = 'team' and c.entity_key = t.slug and c.lang = 'fr'
  );

notify pgrst, 'reload schema';
