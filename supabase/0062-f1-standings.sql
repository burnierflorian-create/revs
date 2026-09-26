-- 0062 — Real championship standings on the F1 grid tables.
--
-- Points/position/wins synced from Jolpica (Ergast successor) by
-- scripts/sync-f1-grid.mjs, replacing the stale AI-generated point counts.
-- Additive + nullable, safe to re-run.

alter table public.f1_grid_teams
  add column if not exists points   int,
  add column if not exists position int,
  add column if not exists wins     int;

alter table public.f1_grid
  add column if not exists points   int,
  add column if not exists position int;
