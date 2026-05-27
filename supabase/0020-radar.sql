-- ─────────────────────── Radar Mode (Premium/VIP) ───────────────────────
-- Per-user opt-in: when a new spot is created within `radius_km` of the
-- user's saved home coordinates, the user gets a push notification.
-- The fanout is computed by `radar_targets(spot_id)` on the server.

create table if not exists public.radar_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  enabled    boolean not null default false,
  radius_km  integer not null default 10 check (radius_km in (5, 10, 20)),
  lat        double precision,
  lng        double precision,
  updated_at timestamptz not null default now()
);

alter table public.radar_prefs enable row level security;

drop policy if exists "radar_prefs read own"   on public.radar_prefs;
drop policy if exists "radar_prefs upsert own" on public.radar_prefs;
drop policy if exists "radar_prefs update own" on public.radar_prefs;

create policy "radar_prefs read own"
  on public.radar_prefs for select
  to authenticated using (user_id = auth.uid());

create policy "radar_prefs upsert own"
  on public.radar_prefs for insert
  to authenticated with check (user_id = auth.uid());

create policy "radar_prefs update own"
  on public.radar_prefs for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────── Haversine helper ───────────────────────
-- Pure SQL haversine to avoid relying on the earthdistance extension
-- (not always enabled on Supabase projects). Result is in kilometers.

create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql
immutable parallel safe
as $$
  select 2 * 6371 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2)) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2))
    * sin(radians((lng2 - lng1) / 2)) ^ 2
  ));
$$;

grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to authenticated, anon;

-- ─────────────────────── radar_targets(spot_id) ───────────────────────
-- Returns the list of Premium/VIP users to notify for a given spot.
-- Each row carries the user's id, distance, and a snapshot of the spot
-- so the caller doesn't need a second fetch.

create or replace function public.radar_targets(p_spot_id uuid)
returns table (
  user_id     uuid,
  distance_km double precision,
  brand       text,
  model       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot public.spots%rowtype;
begin
  select * into v_spot from public.spots where id = p_spot_id;
  if not found then
    return;
  end if;

  return query
    select
      rp.user_id,
      round(public.haversine_km(rp.lat, rp.lng, v_spot.lat, v_spot.lng)::numeric, 1)::double precision,
      v_spot.brand,
      v_spot.model
    from public.radar_prefs rp
    where rp.enabled = true
      and rp.lat is not null
      and rp.lng is not null
      and rp.user_id <> v_spot.user_id
      and public.user_tier(rp.user_id) in ('premium', 'vip')
      and public.haversine_km(rp.lat, rp.lng, v_spot.lat, v_spot.lng) <= rp.radius_km;
end;
$$;

revoke all   on function public.radar_targets(uuid) from public;
grant execute on function public.radar_targets(uuid) to service_role;
