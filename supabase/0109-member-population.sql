-- ═══════ 0109 — UNE SEULE POPULATION, PARTOUT ═══════
--
-- ── L'ÉCART MESURÉ ──
-- Global annonçait 13 membres, le classement en listait 14. La ligne en trop
-- était un profil dont l'onboarding n'est jamais allé au bout : ni pseudo, ni
-- avatar, 0 XP, 0 spot. Une ligne vide en bas du classement.
--
-- La migration 0106 avait donné à Global la définition produit du membre —
-- profil dont l'onboarding est terminé — mais les classements, eux, étaient
-- restés sur « tout profil public ». Deux définitions, deux chiffres.
--
-- ── CE QUI CHANGE ──
-- `top_spotters`, `city_leaderboard` et `countries_leaderboard` appliquent
-- désormais la MÊME condition que members_counts() / members_online() /
-- home_community_stats(). Six fonctions, une seule définition.
--
-- Ce n'est pas un filtre cosmétique : quelqu'un qui n'a pas terminé son
-- inscription n'est pas encore entré dans REVS. Le classer parmi les
-- spotters, c'est annoncer un membre que personne ne peut aller voir.
--
-- `is_public` reste évalué en plus : un membre peut choisir de ne pas figurer
-- au classement, et cette décision lui appartient.

create or replace function public.top_spotters(limit_count integer default 500)
returns table(user_id uuid, xp integer, spots integer, pseudo text, avatar text)
language sql security definer set search_path to 'public'
as $$
  select
    p.user_id,
    coalesce(p.xp_total, 0)::int as xp,
    coalesce(s.spots, 0)::int    as spots,
    p.pseudo,
    p.avatar
  from public.profiles p
  left join (
    select user_id, count(*)::int as spots
      from public.spots group by user_id
  ) s on s.user_id = p.user_id
  where p.onboarding_completed = true
    and (coalesce(p.is_public, true) or p.user_id = auth.uid())
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(limit_count, 1);
$$;

create or replace function public.city_leaderboard(p_city text, p_limit integer default 500)
returns table(user_id uuid, xp integer, spots integer, pseudo text, avatar text)
language sql security definer set search_path to 'public'
as $$
  select
    p.user_id,
    coalesce(p.xp_total, 0)::int as xp,
    coalesce(s.spots, 0)::int    as spots,
    p.pseudo,
    p.avatar
  from public.profiles p
  left join (
    select user_id, count(*)::int as spots
      from public.spots group by user_id
  ) s on s.user_id = p.user_id
  where p.onboarding_completed = true
    and coalesce(lower(trim(p.ville)), '') = lower(trim(p_city))
    and (coalesce(p.is_public, true) or p.user_id = auth.uid())
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(p_limit, 1);
$$;

create or replace function public.countries_leaderboard()
returns table(country text, spotters integer, xp bigint)
language sql security definer set search_path to 'public'
as $$
  select
    coalesce(nullif(trim(p.country), ''), 'France') as country,
    count(*)::int                                   as spotters,
    coalesce(sum(p.xp_total), 0)::bigint            as xp
  from public.profiles p
  where p.onboarding_completed = true
  group by 1
  order by xp desc, spotters desc, country asc;
$$;

comment on function public.top_spotters(integer) is
  'Classement des spotters. Population = profils dont l''onboarding est '
  'terminé, comme members_counts() — les deux chiffres doivent concorder.';

notify pgrst, 'reload schema';
