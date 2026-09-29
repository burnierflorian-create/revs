-- ════════════════════════════════════════════════════════════════════════
--  0082 — Classements : lire le total matérialisé, et respecter is_public
-- ════════════════════════════════════════════════════════════════════════
--
-- Deux corrections, toutes deux directement liées à la refonte XP.
--
--   1. PERFORMANCE. Chaque appel refaisait un `sum(amount) group by user_id`
--      sur TOUT `xp_transactions`, plus un `count(*)` sur TOUT `spots`. À huit
--      comptes c'est gratuit ; l'accueil appelle désormais `top_spotters(200)`
--      à chaque chargement. `profiles.xp_total` (migration 0076) rend la somme
--      inutile — le coût passe d'un balayage complet à une lecture indexée.
--
--   2. CONFIDENTIALITÉ. `profiles.is_public` n'était filtré nulle part : un
--      profil marqué privé apparaissait quand même dans les classements, avec
--      son pseudo et son avatar. Relevé par l'audit, corrigé ici.
--      Le joueur se voit TOUJOURS lui-même, privé ou non.
--
-- Le nombre de spots reste calculé à la volée : il n'a pas de compteur
-- matérialisé, et c'est un simple count indexé par user_id.

create index if not exists profiles_xp_total_idx on public.profiles (xp_total desc);

create or replace function public.top_spotters(limit_count integer default 500)
returns table (user_id uuid, xp integer, spots integer, pseudo text, avatar text)
language sql
security definer
set search_path to 'public'
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
  where coalesce(p.is_public, true) or p.user_id = auth.uid()
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(limit_count, 1);
$$;

create or replace function public.city_leaderboard(p_city text, p_limit integer default 500)
returns table (user_id uuid, xp integer, spots integer, pseudo text, avatar text)
language sql
security definer
set search_path to 'public'
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
  where coalesce(lower(trim(p.ville)), '') = lower(trim(p_city))
    and (coalesce(p.is_public, true) or p.user_id = auth.uid())
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(p_limit, 1);
$$;

-- Le classement par PAYS agrège des pays, pas des joueurs : aucune donnée
-- personnelle n'y transite, donc pas de filtre de visibilité. Seule la source
-- du total change.
create or replace function public.countries_leaderboard()
returns table (country text, spotters integer, xp bigint)
language sql
security definer
set search_path to 'public'
as $$
  select
    coalesce(nullif(trim(p.country), ''), 'France') as country,
    count(*)::int                                   as spotters,
    coalesce(sum(p.xp_total), 0)::bigint            as xp
  from public.profiles p
  group by 1
  order by xp desc, spotters desc, country asc;
$$;

create or replace function public.country_leaderboard(p_country text, p_limit integer default 500)
returns table (user_id uuid, xp integer, spots integer, pseudo text, avatar text)
language sql
security definer
set search_path to 'public'
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
  where coalesce(lower(trim(p.country)), '') = lower(trim(p_country))
    and (coalesce(p.is_public, true) or p.user_id = auth.uid())
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(p_limit, 1);
$$;

-- `my_xp()` reste en place — plusieurs écrans l'appellent encore — mais lit
-- désormais le total matérialisé au lieu de resommer le grand livre.
create or replace function public.my_xp()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  select coalesce((select xp_total from public.profiles where user_id = auth.uid()), 0);
$$;
