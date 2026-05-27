-- ─────────────────────── Event Live Mode ───────────────────────
-- Adds:
--   events.is_live       : organizer toggle for "mode live"
--   spots.event_id       : nullable FK linking a spot to the event it
--                          was posted during (set by the client when
--                          a live event is nearby at insert time)
--   live_events()        : list events currently in their live window
--   event_live_stats()   : counters for the live UI
--   event_live_spots()   : recent spots for the live mini-map

alter table public.events
  add column if not exists is_live boolean not null default false;

-- An event is "currently live" if is_live=true AND we're inside a
-- ±3h window around starts_at (covers arrive-early / linger-after).
-- The 3h window keeps the banner from haunting the home tab after
-- the meet ends — organizers can also flip is_live back off.
alter table public.spots
  add column if not exists event_id uuid references public.events (id) on delete set null;

create index if not exists spots_event_idx on public.spots (event_id) where event_id is not null;

-- ─────────────────────── RPCs ───────────────────────

create or replace function public.live_events()
returns table (
  id         uuid,
  title      text,
  location   text,
  starts_at  timestamptz,
  lat        double precision,
  lng        double precision,
  spot_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.location,
    e.starts_at,
    e.lat,
    e.lng,
    (select count(*)::int from public.spots s where s.event_id = e.id) as spot_count
  from public.events e
  where e.is_live = true
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <= now() + interval '3 hours'
  order by e.starts_at asc;
$$;

grant execute on function public.live_events() to authenticated, anon;

create or replace function public.event_live_stats(p_event_id uuid)
returns table (
  spot_count   integer,
  participant_count integer,
  brand_count  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int             from public.spots where event_id = p_event_id),
    (select count(distinct user_id)::int from public.spots where event_id = p_event_id),
    (select count(distinct brand)::int   from public.spots where event_id = p_event_id);
$$;

grant execute on function public.event_live_stats(uuid) to authenticated, anon;

create or replace function public.event_live_spots(p_event_id uuid, p_limit int default 50)
returns setof public.spots
language sql
stable
security definer
set search_path = public
as $$
  select * from public.spots
  where event_id = p_event_id
  order by created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.event_live_spots(uuid, int) to authenticated, anon;

-- nearby_live_event(lat, lng) — used by NewSpot to decide whether to
-- offer the "I'm at this event" toggle when a live event is close.
create or replace function public.nearby_live_event(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 5
) returns table (
  id        uuid,
  title     text,
  location  text,
  distance_km double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.location,
    round(public.haversine_km(e.lat, e.lng, p_lat, p_lng)::numeric, 1)::double precision as distance_km
  from public.events e
  where e.is_live = true
    and e.lat is not null
    and e.lng is not null
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <= now() + interval '3 hours'
    and public.haversine_km(e.lat, e.lng, p_lat, p_lng) <= p_radius_km
  order by distance_km asc
  limit 1;
$$;

grant execute on function public.nearby_live_event(double precision, double precision, double precision) to authenticated, anon;
