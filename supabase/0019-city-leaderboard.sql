-- ─────────────────────── City leaderboard ───────────────────────
-- Top spotters in a given city, plus aggregate stats (total spots,
-- most-spotted car, top spotter). City matching is case-insensitive
-- with trim — users self-report their city as free text.

create or replace function public.city_leaderboard(
  p_city text,
  p_limit int default 10
)
returns table (
  user_id  uuid,
  xp       integer,
  spots    integer,
  pseudo   text,
  avatar   text
)
language sql
security definer
set search_path = public
as $$
  with city_users as (
    select user_id, pseudo, avatar
    from public.profiles
    where coalesce(lower(trim(ville)), '') = lower(trim(p_city))
      and is_public = true
  ),
  user_xp as (
    select user_id, coalesce(sum(amount), 0)::int as xp
    from public.xp_transactions
    where user_id in (select user_id from city_users)
    group by user_id
  ),
  user_spots as (
    select user_id, count(*)::int as spots
    from public.spots
    where user_id in (select user_id from city_users)
    group by user_id
  )
  select
    cu.user_id,
    coalesce(ux.xp, 0) as xp,
    coalesce(us.spots, 0) as spots,
    cu.pseudo,
    cu.avatar
  from city_users cu
  left join user_xp    ux on ux.user_id = cu.user_id
  left join user_spots us on us.user_id = cu.user_id
  order by xp desc, spots desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.city_leaderboard(text, int) to authenticated, anon;

-- Aggregate city stats: total spots in the city + the most-spotted car.
create or replace function public.city_stats(p_city text)
returns table (
  total_spots integer,
  top_car     text,
  top_car_count integer,
  top_spotter_id uuid,
  top_spotter_pseudo text
)
language sql
security definer
set search_path = public
as $$
  with city_users as (
    select user_id, pseudo
    from public.profiles
    where coalesce(lower(trim(ville)), '') = lower(trim(p_city))
  ),
  city_spots as (
    select s.* from public.spots s
    join city_users cu on cu.user_id = s.user_id
  ),
  top_car_row as (
    select brand || ' ' || model as label, count(*)::int as n
    from city_spots
    where brand <> '' and model <> ''
    group by brand, model
    order by n desc, label asc
    limit 1
  ),
  top_spotter as (
    select s.user_id, count(*)::int as n, cu.pseudo
    from city_spots s
    join city_users cu on cu.user_id = s.user_id
    group by s.user_id, cu.pseudo
    order by n desc
    limit 1
  )
  select
    (select count(*)::int from city_spots),
    (select label from top_car_row),
    (select n     from top_car_row),
    (select user_id from top_spotter),
    (select pseudo  from top_spotter);
$$;

grant execute on function public.city_stats(text) to authenticated, anon;
