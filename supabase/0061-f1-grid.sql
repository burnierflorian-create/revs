-- 0061 — Dynamic F1 grid (roster), synced from OpenF1.
--
-- Source of truth for WHO drives WHAT in the live season — replaces the
-- hardcoded F1_DRIVERS / F1_TEAMS arrays in src/lib/f1team.ts for the
-- roster (team, number, colour, headshot). Editorial fact-sheets stay in
-- f1_teams / f1_drivers (unchanged) and are keyed by the SAME slugs, so
-- the two layers line up.
--
-- Written ONLY by scripts/sync-f1-grid.mjs via the service-role key
-- (service_role bypasses RLS); read is public. Slugs are stable and match
-- src/lib/f1team.ts + the /f1-team/:slug and /f1-driver/:slug URLs. Per
-- the 2026 decision, the slug "sauber" is KEPT even though the team now
-- races as Audi — only the display `name` changes.

create table if not exists public.f1_grid_teams (
  team_slug   text primary key,          -- stable slug (f1team.ts + URLs)
  name        text not null,             -- display name from API (e.g. "Audi")
  color       text,                      -- livery colour hex "#RRGGBB"
  season      int  not null default 2026,
  updated_at  timestamptz not null default now()
);

create table if not exists public.f1_grid (
  driver_slug  text primary key,         -- stable slug (deburred last name)
  name         text not null,            -- "Max Verstappen"
  number       int,
  country      text,                     -- ISO alpha-2 (flag emoji source)
  team_slug    text not null,
  team_color   text,                     -- denormalised for cheap reads
  headshot_url text,                     -- optional; UI defaults to SVG
  active       boolean not null default true,
  season       int not null default 2026,
  session_key  bigint,                   -- OpenF1 session this snapshot came from
  updated_at   timestamptz not null default now()
);

create index if not exists f1_grid_team_idx on public.f1_grid (team_slug);

alter table public.f1_grid_teams enable row level security;
alter table public.f1_grid       enable row level security;

drop policy if exists "f1 grid teams public read" on public.f1_grid_teams;
drop policy if exists "f1 grid public read"       on public.f1_grid;

create policy "f1 grid teams public read"
  on public.f1_grid_teams for select to anon, authenticated using (true);
create policy "f1 grid public read"
  on public.f1_grid for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
