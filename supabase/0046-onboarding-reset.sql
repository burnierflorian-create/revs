-- Force the onboarding to replay for EVERYONE.
-- The column + default false already exist (0045), but earlier rows were
-- backfilled to true. The client now treats profiles.onboarding_completed
-- as the SOLE source of truth (no localStorage gate), so resetting every
-- profile to false makes the 3-slide tuto show exactly once for every
-- existing user. New accounts already start at false (column default), so
-- they get it automatically too.
-- Apply: node scripts/apply-rls.mjs supabase/0046-onboarding-reset.sql

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

-- ALL existing profiles, no exception.
update public.profiles set onboarding_completed = false;

notify pgrst, 'reload schema';
