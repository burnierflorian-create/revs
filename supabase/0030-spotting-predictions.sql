-- Cache the "Meilleur moment pour spotter" daily prediction so the
-- Claude+web_search call only fires once per user per (city, date).
-- Re-generating on every Home mount would burn ~5 k tokens × N users
-- per visit for no gain — the prediction is intentionally daily.
-- Apply: node scripts/apply-rls.mjs supabase/0030-spotting-predictions.sql

create table if not exists public.spotting_predictions (
  user_id          uuid not null references auth.users(id) on delete cascade,
  city             text not null,
  date             date not null,
  message          text not null,
  score_conditions text not null check (score_conditions in ('bon','moyen','mauvais')),
  created_at       timestamptz not null default now(),
  primary key (user_id, city, date)
);

create index if not exists spotting_predictions_user_date_idx
  on public.spotting_predictions (user_id, date desc);

alter table public.spotting_predictions enable row level security;

drop policy if exists "spotting predictions read own"   on public.spotting_predictions;
drop policy if exists "spotting predictions insert own" on public.spotting_predictions;

-- Each user reads / writes their own row only. Writes happen exclusively
-- from the API endpoint via the service-role key; the insert policy is
-- there only so anon access (which never has a matching user_id) stays
-- denied even if a client tries.
create policy "spotting predictions read own"
  on public.spotting_predictions for select to authenticated
  using (user_id = auth.uid());

create policy "spotting predictions insert own"
  on public.spotting_predictions for insert to authenticated
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
