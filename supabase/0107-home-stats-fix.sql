-- ═══════ 0107 — « top_brand is ambiguous » ═══════
--
-- La 0106 a réécrit home_community_stats() en plpgsql avec un paramètre OUT
-- nommé `top_brand`. Dans le corps, `select top_brand from global_stats_mv`
-- devient alors ambigu : Postgres ne sait pas si l'on désigne la colonne de la
-- vue ou la variable de sortie. La fonction compilait, mais échouait à
-- l'exécution — et l'en-tête de l'accueil n'affichait plus rien.
--
-- La référence est donc qualifiée par l'alias de la table. C'est le seul
-- changement : la condition de population reste celle de la 0106.
create or replace function public.home_community_stats()
returns table (spots_today integer, online_now integer, top_brand text)
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
      (select count(*)::int from public.spots s
         where s.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
      (select count(*)::int from public.profiles p
         where p.onboarding_completed = true
           and p.last_seen is not null and p.last_seen >= now() - interval '5 minutes'),
      (select g.top_brand from public.global_stats_mv g);
end;
$$;

grant execute on function public.home_community_stats() to authenticated, anon;
notify pgrst, 'reload schema';
