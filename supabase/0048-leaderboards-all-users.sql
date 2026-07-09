-- Leaderboards: include EVERYONE with a profile (even 0 XP / 0 spots),
-- add a country scope, and stop hiding users behind is_public so the
-- ranking shows the whole community.
-- Apply: node scripts/apply-rls.mjs supabase/0048-leaderboards-all-users.sql

-- ── 1. Country on profiles (app is France-first; refined client-side) ──
alter table public.profiles
  add column if not exists country text;
update public.profiles set country = 'France' where country is null;

-- ── 2. Global top_spotters — now driven by profiles (LEFT JOIN xp/spots)
--      so brand-new, activity-less accounts still appear with 0 XP. ──
drop function if exists public.top_spotters(int);
create or replace function public.top_spotters(limit_count int default 500)
returns table (
  user_id uuid,
  xp      int,
  spots   int,
  pseudo  text,
  avatar  text
)
language sql security definer set search_path = public as $$
  select
    p.user_id,
    coalesce(x.xp, 0)::int    as xp,
    coalesce(s.spots, 0)::int as spots,
    p.pseudo,
    p.avatar
  from public.profiles p
  left join (
    select user_id, sum(amount)::int as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = p.user_id
  left join (
    select user_id, count(*)::int as spots
    from public.spots group by user_id
  ) s on s.user_id = p.user_id
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(limit_count, 1);
$$;
grant execute on function public.top_spotters(int) to authenticated, anon;

-- ── 3. City leaderboard — every city profile (drop is_public filter). ──
create or replace function public.city_leaderboard(
  p_city text,
  p_limit int default 500
)
returns table (
  user_id uuid,
  xp      integer,
  spots   integer,
  pseudo  text,
  avatar  text
)
language sql security definer set search_path = public as $$
  with city_users as (
    select user_id, pseudo, avatar
    from public.profiles
    where coalesce(lower(trim(ville)), '') = lower(trim(p_city))
  )
  select
    cu.user_id,
    coalesce(x.xp, 0)    as xp,
    coalesce(s.spots, 0) as spots,
    cu.pseudo,
    cu.avatar
  from city_users cu
  left join (
    select user_id, sum(amount)::int as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = cu.user_id
  left join (
    select user_id, count(*)::int as spots
    from public.spots group by user_id
  ) s on s.user_id = cu.user_id
  order by xp desc, spots desc, cu.pseudo asc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.city_leaderboard(text, int) to authenticated, anon;

-- ── 4. Country leaderboard — same shape, matched on country. ──
create or replace function public.country_leaderboard(
  p_country text,
  p_limit int default 500
)
returns table (
  user_id uuid,
  xp      integer,
  spots   integer,
  pseudo  text,
  avatar  text
)
language sql security definer set search_path = public as $$
  with country_users as (
    select user_id, pseudo, avatar
    from public.profiles
    where coalesce(lower(trim(country)), '') = lower(trim(p_country))
  )
  select
    cu.user_id,
    coalesce(x.xp, 0)    as xp,
    coalesce(s.spots, 0) as spots,
    cu.pseudo,
    cu.avatar
  from country_users cu
  left join (
    select user_id, sum(amount)::int as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = cu.user_id
  left join (
    select user_id, count(*)::int as spots
    from public.spots group by user_id
  ) s on s.user_id = cu.user_id
  order by xp desc, spots desc, cu.pseudo asc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.country_leaderboard(text, int) to authenticated, anon;

notify pgrst, 'reload schema';
