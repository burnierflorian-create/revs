-- 0063 — 2026 race results (winners), synced from Jolpica.
--
-- One row per completed round. Self-contained (keyed by the real Jolpica
-- round + race name) so it needs no reconciliation with the static
-- GP_2026 calendar, whose round numbering has drifted from the actual
-- 2026 season. Written by scripts/sync-f1-grid.mjs; public read.

create table if not exists public.f1_results (
  round            int primary key,
  race_name        text not null,
  date             date,
  winner_slug      text,
  winner_name      text,
  winner_team_slug text,
  season           int not null default 2026,
  updated_at       timestamptz not null default now()
);

alter table public.f1_results enable row level security;
drop policy if exists "f1 results public read" on public.f1_results;
create policy "f1 results public read"
  on public.f1_results for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
