-- ─────────────────────── home_community_stats — bump self ───────────────────────
-- The home tab polls this RPC every 60s. We bump the caller's
-- last_seen FIRST so the "online_now" count includes the user who's
-- looking at the screen right now, even if the heartbeat in
-- MainLayout hasn't fired yet (race condition on first mount).

create or replace function public.home_community_stats()
returns table (
  spots_today integer,
  online_now  integer,
  top_city    text,
  top_brand   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is not null then
    update public.profiles set last_seen = now() where user_id = v_user;
  end if;
  return query
    select
      (select count(*)::int from public.spots
         where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
      (select count(*)::int from public.profiles
         where last_seen is not null and last_seen >= now() - interval '5 minutes'),
      (select top_city  from public.global_stats_mv),
      (select top_brand from public.global_stats_mv);
end;
$$;

grant execute on function public.home_community_stats() to authenticated, anon;

notify pgrst, 'reload schema';
