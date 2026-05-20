-- Cache the AI-researched car spec sheet on the spot itself so each
-- "À propos de cette voiture" panel triggers at most one Claude call.
-- Apply: node scripts/apply-rls.mjs supabase/0010-car-info.sql

alter table public.spots add column if not exists car_info jsonb;

notify pgrst, 'reload schema';
