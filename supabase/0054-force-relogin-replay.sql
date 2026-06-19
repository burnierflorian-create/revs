-- Force every existing user to (a) replay the redesigned onboarding and
-- (b) re-authenticate once. The client (MainLayout) reads force_relogin
-- and, when true, flips it back to false then calls supabase.auth.signOut()
-- — a safe, reversible alternative to rotating the JWT secret.
-- Apply: node scripts/apply-rls.mjs supabase/0054-force-relogin-replay.sql

alter table public.profiles
  add column if not exists force_relogin boolean not null default false;

-- Everyone re-sees the new tutorial.
update public.profiles set onboarding_completed = false
  where onboarding_completed = true;

-- Everyone is logged out once on their next app load.
update public.profiles set force_relogin = true;

notify pgrst, 'reload schema';
