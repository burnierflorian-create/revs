-- 0055 — Onboarding preferences + i18n.
--
-- Stores the answers collected by the new multi-step onboarding flow so
-- they persist across devices. All columns are additive and nullable (or
-- defaulted), so this migration is safe to re-run and never breaks
-- existing rows.
--
--   language          'fr' | 'en' (mirror of the localStorage UI choice)
--   dream_car         free text — the user's dream car
--   interests         jsonb array of interest ids (e.g. ["supercars","jdm"])
--   discovery_source  how the user heard about REVS (instagram/tiktok/…)

alter table public.profiles
  add column if not exists language text,
  add column if not exists dream_car text,
  add column if not exists interests jsonb not null default '[]'::jsonb,
  add column if not exists discovery_source text;

-- Keep language constrained to the two supported values (drop-then-add so
-- the migration is idempotent).
alter table public.profiles
  drop constraint if exists profiles_language_check;
alter table public.profiles
  add constraint profiles_language_check
  check (language is null or language in ('fr', 'en'));
