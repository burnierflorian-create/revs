-- 0060 — Onboarding v2 "passions auto".
--
-- Three new preference fields collected by the enriched onboarding and
-- editable later from Settings → "Mes passions auto". Additive + nullable
-- / defaulted, so the migration is safe to re-run and never breaks rows.
-- These are STORAGE ONLY for now — the personalisation modules (challenges,
-- leagues, XP multipliers, home content) that read them come later.
--
--   preferred_brands     jsonb array of car make names (1–3), e.g. ["Ferrari","Porsche"]
--   preferred_universes  jsonb array of universe ids (1–3), e.g. ["jdm","f1_motorsport"]
--   ambition             single choice id: fun | ranking | city_number_one | collection

alter table public.profiles
  add column if not exists preferred_brands jsonb not null default '[]'::jsonb,
  add column if not exists preferred_universes jsonb not null default '[]'::jsonb,
  add column if not exists ambition text;

-- Constrain ambition to the four known ids (drop-then-add = idempotent).
alter table public.profiles
  drop constraint if exists profiles_ambition_check;
alter table public.profiles
  add constraint profiles_ambition_check
  check (
    ambition is null
    or ambition in ('fun', 'ranking', 'city_number_one', 'collection')
  );
