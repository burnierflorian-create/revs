-- Force the full onboarding flow (3 slides + 5-step guided tour) to replay
-- once for EVERYONE. The tour is part of the same flow gated by
-- profiles.onboarding_completed, which only flips true at the very end
-- ("Allons-y 🚀"). Reset all profiles to false so the slides + tour show
-- once for every existing user; new accounts already default to false.
-- Apply: node scripts/apply-rls.mjs supabase/0047-onboarding-tour-reset.sql

update public.profiles set onboarding_completed = false;

notify pgrst, 'reload schema';
