-- ─────────────────────── Car catalog (rarity frozen once) ───────────────────────
-- One canonical row per (brand, model): its market value and the rarity
-- DERIVED from that value (price → rarity thresholds, 2026-07 rule). Written
-- once, when a model is first spotted; every later spot of that model READS
-- this row — no AI, no price re-lookup, no rarity recompute.
--
-- Keyed by a normalized slug = lower/trim/de-accented "brand|model" so
-- "Lamborghini Huracán EVO" and "lamborghini huracan evo" collapse to one.

create table if not exists public.car_catalog (
  slug         text primary key,
  brand        text not null,
  model        text not null,
  market_value integer,          -- € resale value, frozen at first sighting
  rarity       text not null default 'standard',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.car_catalog enable row level security;

-- Public read (the catalog is not user data); writes only via service_role
-- (which bypasses RLS), so no INSERT/UPDATE policy is granted to clients.
drop policy if exists car_catalog_read on public.car_catalog;
create policy car_catalog_read on public.car_catalog for select using (true);

grant select on public.car_catalog to anon, authenticated;
