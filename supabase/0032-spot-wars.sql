-- ─────────────────────── Spot Wars — city vs city ───────────────────────
-- Weekly leaderboard of cities ranked by how many spots their residents
-- (profiles.ville) posted this ISO-week. Pure read-only RPC; resets
-- naturally every Monday because the WHERE clause uses date_trunc('week').
-- Apply: node scripts/apply-rls.mjs supabase/0032-spot-wars.sql

create or replace function public.spot_wars_leaderboard(
  p_limit int default 10
) returns table (
  rank          int,
  city          text,
  spots_week    bigint,
  total_pct     numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      coalesce(nullif(trim(p.ville), ''), 'Inconnue') as city,
      count(*)::bigint as spots_week
    from public.spots s
    join public.profiles p on p.user_id = s.user_id
    where s.created_at >= date_trunc('week', now())
      and p.ville is not null
      and trim(p.ville) <> ''
    group by coalesce(nullif(trim(p.ville), ''), 'Inconnue')
  ),
  top as (
    select
      row_number() over (order by spots_week desc, city asc)::int as rank,
      city,
      spots_week
    from ranked
    order by spots_week desc, city asc
    limit greatest(p_limit, 1)
  ),
  best as (
    select coalesce(max(spots_week), 1) as best_count from top
  )
  select
    t.rank,
    t.city,
    t.spots_week,
    round((t.spots_week::numeric / b.best_count::numeric) * 100, 0) as total_pct
  from top t cross join best b
  order by t.rank;
$$;

grant execute on function public.spot_wars_leaderboard(int) to authenticated, anon;

notify pgrst, 'reload schema';
