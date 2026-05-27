-- ─────────────────────── Home stats — top brand of the day ───────────────────────
-- "Marque N°1 du jour" replaces the all-time top from the materialized
-- view. Cheap to compute (today's spots only, indexed by created_at),
-- recomputed on every 60s poll from the home tab.
--
-- Also keeps the implicit bump of the caller's last_seen (introduced
-- in 0026) so the user themselves is always part of "online_now".

-- Return type changes (top_city column removed) → must DROP first;
-- CREATE OR REPLACE refuses to mutate the OUT signature.
drop function if exists public.home_community_stats();

create or replace function public.home_community_stats()
returns table (
  spots_today integer,
  online_now  integer,
  top_brand   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  if v_user is not null then
    update public.profiles set last_seen = now() where user_id = v_user;
  end if;
  return query
    select
      (select count(*)::int from public.spots
         where created_at >= v_day_start),
      (select count(*)::int from public.profiles
         where last_seen is not null and last_seen >= now() - interval '5 minutes'),
      (select brand
         from public.spots
         where created_at >= v_day_start and brand <> ''
         group by brand
         order by count(*) desc, brand asc
         limit 1);
end;
$$;

grant execute on function public.home_community_stats() to authenticated, anon;

notify pgrst, 'reload schema';
