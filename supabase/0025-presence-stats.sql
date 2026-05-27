-- ─────────────────────── Presence (last_seen) ───────────────────────
-- Caller heartbeats `bump_last_seen()` every minute from the client to
-- keep their row warm. "Online now" = profiles with last_seen ≥ now-5m.

alter table public.profiles
  add column if not exists last_seen timestamptz;

create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen desc nulls last)
  where last_seen is not null;

create or replace function public.bump_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  update public.profiles set last_seen = now() where user_id = v_user;
end;
$$;

grant execute on function public.bump_last_seen() to authenticated;

-- ─────────────────────── Home stats RPC ───────────────────────
-- Mix of real-time and cached: today's spots and online users are
-- computed on every call (cheap — tiny dataset, indexed columns), top
-- city / top brand come from the materialized view refreshed daily.

create or replace function public.home_community_stats()
returns table (
  spots_today integer,
  online_now  integer,
  top_city    text,
  top_brand   text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.spots
       where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    (select count(*)::int from public.profiles
       where last_seen is not null and last_seen >= now() - interval '5 minutes'),
    (select top_city  from public.global_stats_mv),
    (select top_brand from public.global_stats_mv);
$$;

grant execute on function public.home_community_stats() to authenticated, anon;
