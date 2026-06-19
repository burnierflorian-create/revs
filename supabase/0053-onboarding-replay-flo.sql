-- One-shot: replay the onboarding tutorial for the owner account only
-- (so it can be re-tested) without disrupting every other user.
-- Apply: node scripts/apply-rls.mjs supabase/0053-onboarding-replay-flo.sql

update public.profiles p
set onboarding_completed = false
from auth.users u
where u.id = p.user_id
  and lower(u.email) = 'burnier.florian13@gmail.com';
