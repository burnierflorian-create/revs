-- 0056 — Showroom realistic renders.
--
-- Flexible per-car image system for the "Mon Showroom" gallery:
--   spots.realistic_render_url : optional per-spot override. If set, the
--     showroom displays this render instead of the user's raw photo.
--   car_renders : a SHARED library of reusable realistic renders keyed by
--     (make, model). Lets us enrich renders progressively without touching
--     existing spots. Display logic (client): spot.realistic_render_url
--     → car_renders[make, model] → spot.photo_url.

alter table public.spots
  add column if not exists realistic_render_url text;

create table if not exists public.car_renders (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  render_url text not null,
  created_at timestamptz not null default now(),
  unique (make, model)
);

-- Case-insensitive lookup helper.
create index if not exists car_renders_make_model_idx
  on public.car_renders (lower(make), lower(model));

alter table public.car_renders enable row level security;

-- The render library is public-read for any authenticated user; writes are
-- service-role only (no insert/update/delete policy → blocked otherwise).
drop policy if exists car_renders_read on public.car_renders;
create policy car_renders_read on public.car_renders
  for select using (true);
