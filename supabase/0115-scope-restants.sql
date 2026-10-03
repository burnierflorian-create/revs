-- ═══════ LES TROIS FONCTIONS QUE L'AUDIT MANUEL AVAIT MANQUÉES ═══════
--
-- Le garde-fou de la 0114 les a trouvées en une seconde, là où la relecture
-- à l'œil en avait laissé passer trois sur onze. Chacune décidait seule qui
-- compte comme membre, et chacune se trompait différemment :
--
--   country_leaderboard() — filtrait `is_public` mais PAS
--     `onboarding_completed`. Un profil abandonné en cours d'inscription
--     apparaissait donc dans le classement de son pays.
--
--   global_search() — même oubli sur le volet « spotters ». Chercher un
--     pseudo pouvait renvoyer quelqu'un qui n'est pas membre, et dont le
--     profil s'ouvrait vide.
--
--   my_rank() — calculait le rang contre `is_public` seul. On pouvait donc
--     être annoncé 6e sur un classement où l'on apparaît 5e : le rang était
--     mesuré contre une population plus large que celle affichée.
--
-- Aucune ne se voyait dans les totaux, parce qu'aucun membre n'est privé
-- aujourd'hui et que les profils incomplets sont rares. C'est exactement ce
-- que vaut un contrôle structurel face à un contrôle par les chiffres.

create or replace function public.country_leaderboard(p_country text, p_limit integer default 500)
returns table (user_id uuid, xp integer, spots integer, pseudo text, avatar text)
language sql
security definer
set search_path = public
as $$
  select
    m.user_id,
    coalesce(m.xp_total, 0)::int as xp,
    coalesce(s.spots, 0)::int    as spots,
    m.pseudo,
    m.avatar
  from public.member_directory m
  left join (
    select sp.user_id, count(*)::int as spots
      from public.spots sp group by sp.user_id
  ) s on s.user_id = m.user_id
  where coalesce(lower(trim(m.country)), '') = lower(trim(p_country))
  order by xp desc, spots desc, m.pseudo asc
  limit greatest(p_limit, 1);
$$;

create or replace function public.my_rank()
returns integer
language sql
security definer
set search_path = public
as $$
  select case
    when (select coalesce(xp_total, 0) from public.profiles where user_id = auth.uid()) <= 0
      then null
    else (
      -- Compté sur la MÊME population que celle qu'affiche le classement :
      -- un rang qui se mesure contre d'autres gens que ceux qu'on voit à
      -- l'écran n'est pas un rang, c'est un nombre.
      select count(*)::int + 1
        from public.member_directory m
       where m.xp_total > (
             select coalesce(xp_total, 0) from public.profiles where user_id = auth.uid()
           )
    )
  end;
$$;

create or replace function public.global_search(p_q text, p_limit integer default 20)
returns table (kind text, label text, sublabel text, ref_id text, rank integer)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(trim(p_q)) as needle
  ),
  cars as (
    select
      'car'::text as kind,
      s.brand || ' ' || s.model as label,
      count(*)::text || ' spot' || case when count(*) > 1 then 's' else '' end as sublabel,
      (
        select id::text from public.spots s2
        where s2.brand = s.brand and s2.model = s.model
        order by created_at desc limit 1
      ) as ref_id,
      (case when lower(s.brand || ' ' || s.model) like (select needle from q) || '%' then 10 else 5 end) as rank
    from public.spots s
    where lower(s.brand || ' ' || s.model) like '%' || (select needle from q) || '%'
    group by s.brand, s.model
    order by count(*) desc
    limit 8
  ),
  -- Spotters : la recherche ne propose que de VRAIS membres. Renvoyer un
  -- profil abandonné en cours d'inscription ouvrait une page sans pseudo,
  -- sans avatar et sans spot.
  spotters as (
    select
      'spotter'::text as kind,
      coalesce(m.pseudo, 'Spotter') as label,
      coalesce(m.ville, '') as sublabel,
      m.user_id::text as ref_id,
      (case when lower(coalesce(m.pseudo, '')) like (select needle from q) || '%' then 9 else 4 end) as rank
    from public.member_directory m
    where m.pseudo is not null
      and lower(m.pseudo) like '%' || (select needle from q) || '%'
    limit 8
  ),
  cities as (
    select
      'city'::text as kind,
      m.ville as label,
      count(s.id)::text || ' spot' || case when count(s.id) > 1 then 's' else '' end as sublabel,
      m.ville as ref_id,
      (case when lower(m.ville) like (select needle from q) || '%' then 8 else 3 end) as rank
    from public.member_directory m
    join public.spots s on s.user_id = m.user_id
    where m.ville is not null and trim(m.ville) <> ''
      and lower(m.ville) like '%' || (select needle from q) || '%'
    group by m.ville
    order by count(s.id) desc
    limit 5
  ),
  combined as (
    select * from cars
    union all select * from spotters
    union all select * from cities
  )
  select * from combined all_hits
  where length((select needle from q)) >= 2
  order by rank desc, label asc
  limit p_limit;
$$;

-- ── LE GARDE-FOU NE DOIT PAS SE DÉNONCER LUI-MÊME ──
-- `mark_onboarding_as_activity()` ÉCRIT `onboarding_completed` ; elle ne
-- déclare aucun périmètre. L'exclure nommément plutôt qu'assouplir le motif :
-- une exception se relit, un motif élargi laisse passer ce qu'on ne voit pas.
create or replace function public.functions_declaring_member_scope()
returns table (proname text)
language sql
stable
security definer
set search_path = public
as $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname not in (
      'functions_declaring_member_scope',
      'mark_onboarding_as_activity'
    )
    and pg_get_functiondef(p.oid) ~* '(onboarding_completed|is_public)'
    and pg_get_functiondef(p.oid) !~* 'member_directory'
  order by 1;
$$;

notify pgrst, 'reload schema';
