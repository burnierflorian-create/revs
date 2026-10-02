-- ═══════ 0104 — LA LISTE DES MEMBRES EN LIGNE ═══════
--
-- ── POURQUOI UNE RPC PLUTÔT QU'UNE REQUÊTE CLIENT ──
-- Le compteur « X en ligne » existe depuis la migration 0025 : il compte les
-- profils dont `last_seen` date de moins de 5 minutes. Pour afficher la LISTE
-- correspondante, un client pourrait interroger `profiles` directement — mais
-- il devrait alors lire `last_seen` pour filtrer, c'est-à-dire recevoir
-- l'horodatage de dernière activité de TOUT LE MONDE. Un compteur dit « trois
-- personnes sont là » ; une liste d'horodatages dit « voici quand chacun est
-- passé pour la dernière fois ». Ce n'est pas la même chose, et la seconde n'a
-- aucune raison d'être exposée.
--
-- Le filtre reste donc côté serveur, et la fonction ne renvoie que ce que
-- l'interface affiche réellement : identifiant, pseudo, avatar.
--
-- ── UNE SEULE DÉFINITION DE « EN LIGNE » ──
-- Le seuil de 5 minutes est repris À L'IDENTIQUE de home_community_stats().
-- S'ils divergeaient, le compteur annoncerait quatre personnes et la liste en
-- montrerait deux — exactement le défaut que cette fonctionnalité doit éviter.
-- Les deux lisent la même colonne avec le même intervalle.

create or replace function public.members_online()
returns table (
  user_id uuid,
  pseudo  text,
  avatar  text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.pseudo, p.avatar
  from public.profiles p
  where p.last_seen is not null
    and p.last_seen >= now() - interval '5 minutes'
  order by p.pseudo nulls last
  limit 100;
$$;

comment on function public.members_online() is
  'Membres actuellement en ligne (last_seen < 5 min), champs publics seulement. '
  'Même seuil que home_community_stats() — les deux doivent toujours concorder.';

-- ── LE TOTAL DES MEMBRES ──
-- Compte les PROFILS, pas les comptes `auth.users` : un compte sans profil n'a
-- ni pseudo ni avatar, donc rien à montrer dans une liste de membres. Le
-- libellé affiché dit « membres REVS », jamais « utilisateurs actifs » — ce
-- serait une promesse que ce chiffre ne tient pas.
create or replace function public.members_counts()
returns table (
  online_now integer,
  total      integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.profiles
       where last_seen is not null and last_seen >= now() - interval '5 minutes'),
    (select count(*)::int from public.profiles);
$$;

comment on function public.members_counts() is
  'Compteurs du panneau Membres : en ligne (même seuil que members_online) et '
  'total des PROFILS (un compte sans profil n''est pas listable).';

revoke all on function public.members_online() from public;
revoke all on function public.members_counts() from public;
grant execute on function public.members_online() to authenticated;
grant execute on function public.members_counts() to authenticated;
