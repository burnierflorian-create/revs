-- ─────────────────────── Global app stats ───────────────────────
-- A single-row materialized view computed across the spots table.
-- Refreshed by cron-notify.ts?action=stats every hour. Cheap to
-- read, no per-request aggregation cost.

create materialized view if not exists public.global_stats_mv as
with
  totals as (
    select count(*)::bigint as total_spots from public.spots
  ),
  top_car as (
    select brand || ' ' || model as label, count(*)::bigint as n
    from public.spots
    where brand <> '' and model <> ''
    group by brand, model
    order by n desc, label asc
    limit 1
  ),
  top_city as (
    select coalesce(p.ville, '') as label, count(*)::bigint as n
    from public.spots s
    join public.profiles p on p.user_id = s.user_id
    where coalesce(p.ville, '') <> ''
    group by p.ville
    order by n desc
    limit 1
  ),
  top_brand as (
    select brand as label, count(*)::bigint as n
    from public.spots
    where brand <> ''
    group by brand
    order by n desc, label asc
    limit 1
  ),
  weekly_active as (
    select count(distinct user_id)::bigint as n
    from public.spots
    where created_at >= now() - interval '7 days'
  )
select
  (select total_spots from totals)            as total_spots,
  (select label       from top_car)           as top_car,
  (select n           from top_car)           as top_car_count,
  (select label       from top_city)          as top_city,
  (select n           from top_city)          as top_city_count,
  (select label       from top_brand)         as top_brand,
  (select n           from top_brand)         as top_brand_count,
  (select n           from weekly_active)     as weekly_active_spotters,
  now()                                       as refreshed_at;

create unique index if not exists global_stats_mv_singleton_idx
  on public.global_stats_mv ((1));

-- Public read RPC. Returns the single row. Refresh is the cron's job.
create or replace function public.global_stats()
returns table (
  total_spots             bigint,
  top_car                 text,
  top_car_count           bigint,
  top_city                text,
  top_city_count          bigint,
  top_brand               text,
  top_brand_count         bigint,
  weekly_active_spotters  bigint,
  refreshed_at            timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    total_spots,
    top_car, top_car_count,
    top_city, top_city_count,
    top_brand, top_brand_count,
    weekly_active_spotters,
    refreshed_at
  from public.global_stats_mv;
$$;

grant execute on function public.global_stats() to authenticated, anon;

-- Cron-callable refresher. service_role only.
create or replace function public.refresh_global_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.global_stats_mv;
exception when others then
  -- CONCURRENTLY fails on the very first refresh; fall back once.
  refresh materialized view public.global_stats_mv;
end;
$$;

revoke all   on function public.refresh_global_stats() from public;
grant execute on function public.refresh_global_stats() to service_role;
