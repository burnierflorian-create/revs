-- World leaderboard BY COUNTRY: one row per country with its spotter
-- count and the cumulative XP of all its spotters. Powers the renamed
-- "🌍 Pays" tab which ranks every country on the planet.
-- Apply: node scripts/apply-rls.mjs supabase/0049-countries-leaderboard.sql

create or replace function public.countries_leaderboard()
returns table (
  country  text,
  spotters int,
  xp       bigint
)
language sql security definer set search_path = public as $$
  select
    coalesce(nullif(trim(p.country), ''), 'France') as country,
    count(*)::int                                   as spotters,
    coalesce(sum(x.xp), 0)::bigint                  as xp
  from public.profiles p
  left join (
    select user_id, sum(amount)::bigint as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = p.user_id
  group by 1
  order by xp desc, spotters desc, country asc;
$$;
grant execute on function public.countries_leaderboard() to authenticated, anon;

notify pgrst, 'reload schema';
