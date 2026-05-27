-- F1 teams + drivers cached fact-sheets, populated lazily by Claude
-- web_search on first visit and refreshed every 7 days.
-- Apply: node scripts/apply-rls.mjs supabase/0013-f1-teams-drivers.sql
--
-- `slug` everywhere matches src/lib/f1team.ts and is the catalogue
-- identifier (kebab-case). `data` is the structured JSON returned by
-- the API endpoint; its shape is documented next to the call site in
-- src/pages/F1TeamDetail.tsx / F1DriverDetail.tsx.

create table if not exists public.f1_teams (
  slug         text primary key,
  data         jsonb not null,
  generated_at timestamptz not null default now()
);

create table if not exists public.f1_drivers (
  slug         text primary key,
  data         jsonb not null,
  generated_at timestamptz not null default now()
);

alter table public.f1_teams   enable row level security;
alter table public.f1_drivers enable row level security;

drop policy if exists "f1 teams public read"   on public.f1_teams;
drop policy if exists "f1 drivers public read" on public.f1_drivers;

-- Read is public (info shown to every visitor). Writes only via the
-- service-role key from the API; no client-side policy needed.
create policy "f1 teams public read"
  on public.f1_teams for select to anon, authenticated using (true);
create policy "f1 drivers public read"
  on public.f1_drivers for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
