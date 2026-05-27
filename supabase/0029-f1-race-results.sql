-- F1 race results cached per round, populated lazily by Claude
-- web_search the first time a past GP detail page is opened. Once a
-- round has been raced its results never change, so we cache forever
-- (no TTL) — the row is only ever rewritten by the refresh cron path.
-- Apply: node scripts/apply-rls.mjs supabase/0029-f1-race-results.sql

create table if not exists public.f1_race_results (
  round        int primary key,
  data         jsonb not null,
  generated_at timestamptz not null default now()
);

alter table public.f1_race_results enable row level security;

drop policy if exists "f1 race results public read" on public.f1_race_results;

-- Read is public (info shown to every visitor). Writes only via the
-- service-role key from the API; no client-side policy needed.
create policy "f1 race results public read"
  on public.f1_race_results for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
