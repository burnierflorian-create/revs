-- ─────────────────────── Card back: specs cache + community meta ───────────────────────
-- Two pieces of infrastructure for the redesigned card back:
--   1. `car_specs` — shared cache, one row per (brand, model, year). Specs
--       are static facts so a single Claude+web_search call is reused
--       across every user looking at this car.
--   2. `get_user_cards_meta(p_user)` — batched RPC returning per-spot
--       community stats (count of same-(brand,model) spots on REVS,
--       whether this spot is the earliest of that model). One call,
--       N rows.
--
-- City-based "1er à <ville>" is intentionally skipped — see the
-- 2026-05-27 session decision (no city column on spots; reverse-
-- geocoding is out-of-scope). We surface "1er sur REVS" instead.

create table if not exists public.car_specs (
  slug         text primary key,
  brand        text not null,
  model        text not null,
  year         integer,
  -- {"horsepower": "562 ch", "zero_to_100": "3.2 s",
  --  "top_speed": "320 km/h", "torque": "750 Nm",
  --  "fun_fact": "Le V8 biturbo développe 562ch."}
  data         jsonb not null,
  fetched_at   timestamptz not null default now()
);

create index if not exists car_specs_fetched_at_idx
  on public.car_specs (fetched_at desc);

alter table public.car_specs enable row level security;

drop policy if exists "car_specs read all"      on public.car_specs;
drop policy if exists "car_specs write service" on public.car_specs;

create policy "car_specs read all"
  on public.car_specs
  for select
  to authenticated
  using (true);

-- ─────────────────────── Batched cards meta RPC ───────────────────────
-- Returns one row per spot owned by `p_user`. The caller computes
-- the card number client-side from chronological position in their
-- own spots; everything that needs a cross-user scan lives here.

create or replace function public.get_user_cards_meta(p_user uuid)
returns table (
  spot_id          uuid,
  spots_count      integer,
  is_first_on_revs boolean
)
language sql
security definer
set search_path = public
as $$
  with me as (
    select id, brand, model, created_at
    from public.spots
    where user_id = p_user
  ),
  per_model as (
    select
      lower(s.brand) as br,
      lower(s.model) as md,
      count(*)::int  as cnt,
      min(s.created_at) as earliest_at,
      -- Tie-break by id so concurrent inserts at the same timestamp
      -- pick a deterministic earliest spot.
      (array_agg(s.id order by s.created_at asc, s.id asc))[1] as earliest_id
    from public.spots s
    where (lower(s.brand), lower(s.model)) in (
      select lower(brand), lower(model) from me
    )
    group by lower(s.brand), lower(s.model)
  )
  select
    m.id                     as spot_id,
    p.cnt                    as spots_count,
    (p.earliest_id = m.id)   as is_first_on_revs
  from me m
  left join per_model p
    on p.br = lower(m.brand) and p.md = lower(m.model);
$$;

grant execute on function public.get_user_cards_meta(uuid) to authenticated;
