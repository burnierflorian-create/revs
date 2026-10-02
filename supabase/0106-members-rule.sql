-- ═══════ 0106 — « MEMBRE » A UNE DÉFINITION, ET UNE SEULE ═══════
--
-- La migration 0104 comptait TOUS les profils. Depuis 0105, un profil naît
-- avec le compte : quelqu'un qui vient de créer son compte mais n'a pas
-- encore traversé l'onboarding a donc désormais une ligne — et serait compté
-- comme membre alors qu'il n'est pas encore entré dans l'application.
--
-- La règle produit est explicite : est membre REVS celui dont l'inscription
-- ET l'onboarding obligatoire sont terminés. Rien d'autre n'est exigé — ni
-- spot, ni véhicule, ni avatar, ni abonné, ni seconde visite.
--
-- Les trois fonctions ci-dessous partagent la MÊME condition. Elles ne
-- peuvent donc pas diverger : c'est précisément le défaut qu'on cherche à
-- rendre impossible, un compteur annonçant un nombre que la liste ne montre
-- pas.

create or replace function public.members_online()
returns table (user_id uuid, pseudo text, avatar text)
language sql stable security definer set search_path = public
as $$
  select p.user_id, p.pseudo, p.avatar
  from public.profiles p
  where p.onboarding_completed = true
    and p.last_seen is not null
    and p.last_seen >= now() - interval '5 minutes'
  order by p.pseudo nulls last
  limit 100;
$$;

create or replace function public.members_counts()
returns table (online_now integer, total integer)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*)::int from public.profiles
       where onboarding_completed = true
         and last_seen is not null and last_seen >= now() - interval '5 minutes'),
    (select count(*)::int from public.profiles
       where onboarding_completed = true);
$$;

-- Le compteur de l'accueil lit la même population : sans cela, l'en-tête et
-- le panneau annonceraient deux nombres différents pour la même chose.
--
-- ⚠️ La signature reprise ici est celle RÉELLEMENT en base — trois colonnes,
-- sans `top_city`. Le fichier de la migration 0026 en déclare quatre : la
-- fonction a été modifiée depuis sans que ce fichier soit mis à jour.
-- Postgres refuse de changer le type de retour d'une fonction existante, donc
-- s'aligner sur le fichier aurait fait échouer la migration.
--
-- Son effet de bord est conservé : elle rafraîchit d'abord le `last_seen` de
-- l'appelant, pour qu'il se compte lui-même dès le premier appel sans
-- attendre le battement de MainLayout.
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
      (select count(*)::int from public.spots
         where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
      (select count(*)::int from public.profiles
         where onboarding_completed = true
           and last_seen is not null and last_seen >= now() - interval '5 minutes'),
      (select top_brand from public.global_stats_mv);
end;
$$;

comment on function public.members_counts() is
  'Population REVS : profils dont l''onboarding est terminé. « En ligne » = '
  'last_seen < 5 min. Même condition que members_online() et '
  'home_community_stats() — les trois doivent toujours concorder.';

grant execute on function public.members_online() to authenticated;
grant execute on function public.members_counts() to authenticated;
grant execute on function public.home_community_stats() to authenticated, anon;
