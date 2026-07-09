-- Onboarding completion flag. Set true the first time a user finishes
-- (or skips) the 3-slide onboarding. The client also mirrors it to
-- localStorage for an instant, offline-friendly first-launch check; this
-- column is the cross-device source of truth (covered by the existing
-- owner-update RLS policy on profiles).
-- Apply: node scripts/apply-rls.mjs supabase/0045-onboarding.sql

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

-- Backfill: anyone who already has a pseudo clearly went through the old
-- onboarding, so flag them done — they must never see the new flow again,
-- even from a fresh device with no localStorage.
update public.profiles
  set onboarding_completed = true
  where coalesce(trim(pseudo), '') <> ''
    and onboarding_completed = false;

notify pgrst, 'reload schema';
