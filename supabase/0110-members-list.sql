-- ═══════ 0110 — LA LISTE COMPLÈTE DES MEMBRES ═══════
--
-- `members_online()` (0104) ne renvoyait que les présents, et seulement trois
-- champs. Le panneau demandé montre les DEUX populations, avec de quoi
-- reconnaître quelqu'un : pseudo, ville, dernière activité relative.
--
-- ── POURQUOI UNE SEULE FONCTION PLUTÔT QUE DEUX ──
-- Deux fonctions « en ligne » et « hors ligne » pourraient diverger — c'est
-- exactement le défaut qu'on vient de corriger ailleurs. Une seule source
-- renvoie tout le monde avec un drapeau `online`, et l'interface sépare. Le
-- total ne peut alors pas différer de la somme des deux onglets.
--
-- ── CE QUI N'EST PAS RENVOYÉ ──
-- Pas d'e-mail, pas de `last_seen` brut. La dernière activité sort en MINUTES
-- écoulées, arrondies : « il y a 2 h » se construit côté client sans jamais
-- recevoir un horodatage. Un compteur dit « untel est passé récemment » ;
-- un horodatage dirait exactement quand, tous les jours, pour tout le monde.
create or replace function public.members_list()
returns table (
  user_id      uuid,
  pseudo       text,
  avatar       text,
  ville        text,
  role         text,
  online       boolean,
  minutes_ago  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    p.pseudo,
    p.avatar,
    p.ville,
    p.role,
    (p.last_seen is not null and p.last_seen >= now() - interval '5 minutes') as online,
    case
      when p.last_seen is null then null
      else least(greatest(extract(epoch from (now() - p.last_seen)) / 60, 0), 1051200)::int
    end as minutes_ago
  from public.profiles p
  where p.onboarding_completed = true
  order by
    (p.last_seen is not null and p.last_seen >= now() - interval '5 minutes') desc,
    p.last_seen desc nulls last,
    p.pseudo asc
  limit 500;
$$;

comment on function public.members_list() is
  'Tous les membres REVS (onboarding terminé), en ligne d''abord. Champs '
  'publics uniquement ; la dernière activité sort en minutes écoulées, jamais '
  'en horodatage. Même population que members_counts() et top_spotters().';

revoke all on function public.members_list() from public;
grant execute on function public.members_list() to authenticated;

notify pgrst, 'reload schema';
