-- ═══════ PÉRIMÈTRE MEMBRE ET PRÉSENCE : UNE SEULE DÉFINITION ═══════
--
-- ── CE QUE L'AUDIT A TROUVÉ ──
-- Huit fonctions décidaient chacune, pour leur compte, qui est « membre » et
-- qui est « en ligne ». Six écrivaient :
--     onboarding_completed = true
-- et deux — top_spotters() et city_leaderboard() — écrivaient :
--     onboarding_completed = true
--     and (coalesce(is_public, true) or user_id = auth.uid())
--
-- Aujourd'hui les deux formulations donnent 13 des deux côtés, parce que
-- personne n'a encore mis is_public à false. Le jour où un membre le fait,
-- le panneau Membres annonce 13 et le classement en liste 12. C'est
-- exactement l'écart « Global 12 / classement 13 » déjà observé : il ne vient
-- pas d'un bug d'affichage mais de deux définitions concurrentes qui
-- s'appliquent au même ensemble.
--
-- Quatre définitions du seuil « en ligne » coexistaient de la même manière,
-- chacune réécrivant `interval '5 minutes'` à la main.
--
-- ── LA CORRECTION ──
-- Une vue, `member_directory`, porte le périmètre. Une fonction,
-- `presence_window()`, porte le seuil. Toutes les surfaces lisent les deux.
-- Il devient impossible d'en changer une sans changer les autres, parce
-- qu'il n'y a plus qu'un seul endroit où elles sont écrites.

-- ── LE SEUIL ──
-- Cinq minutes. Le battement client écrit toutes les 60 s tant que l'onglet
-- est visible ; cinq minutes laissent donc passer quatre battements manqués
-- avant de déclarer quelqu'un parti — assez pour absorber un tunnel, un
-- changement de réseau ou un écran verrouillé quelques instants, trop peu
-- pour qu'un onglet fermé reste « en ligne » longtemps.
create or replace function public.presence_window()
returns interval
language sql
immutable
parallel safe
as $$ select interval '5 minutes' $$;

comment on function public.presence_window() is
  'Durée au-delà de laquelle un membre n''est plus « en ligne ». Seul endroit '
  'où ce seuil est écrit : toute surface qui parle de présence lit ceci.';

-- ── LE PÉRIMÈTRE ──
-- Membre public REVS = inscription terminée ET profil public.
--
-- `is_public = false` n'est pas une demi-mesure : la policy de `profiles`
-- rend déjà ce profil illisible par les autres. Le compter dans un total
-- public annoncerait une population que personne ne peut consulter.
--
-- security_invoker : la vue n'accorde aucun droit que l'appelant n'a pas.
-- Lue par une fonction SECURITY DEFINER elle voit tout ; lue directement par
-- un utilisateur elle reste soumise aux policies de `profiles`.
drop view if exists public.member_directory;
create view public.member_directory
with (security_invoker = true) as
  select
    p.user_id,
    p.pseudo,
    p.avatar,
    p.ville,
    p.country,
    p.role,
    p.title,
    p.xp_total,
    p.last_seen,
    (p.last_seen is not null and p.last_seen >= now() - public.presence_window()) as online,
    -- Minutes écoulées, jamais l'horodatage. Le client compose « il y a 2 h »
    -- à partir de ce nombre : il n'apprend donc pas à quelle heure précise
    -- quelqu'un a ouvert l'application, tous les jours, pour toujours.
    -- Plafonné à deux ans pour qu'une date aberrante ne produise pas un
    -- libellé absurde.
    case
      when p.last_seen is null then null
      else least(greatest(extract(epoch from (now() - p.last_seen)) / 60, 0), 1051200)::int
    end as minutes_ago
  from public.profiles p
  where p.onboarding_completed = true
    and p.is_public = true;

comment on view public.member_directory is
  'LE périmètre des membres publics REVS. Toute fonction qui compte, liste ou '
  'classe des membres lit cette vue — jamais `profiles` directement — pour '
  'qu''il n''existe pas deux réponses à « qui est membre ? ».';

grant select on public.member_directory to anon, authenticated;

-- ═══════ LES SURFACES, TOUTES RÉÉCRITES SUR LA VUE ═══════

create or replace function public.members_list()
returns table (
  user_id uuid, pseudo text, avatar text, ville text, role text,
  online boolean, minutes_ago integer
)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.pseudo, m.avatar, m.ville, m.role, m.online, m.minutes_ago
  from public.member_directory m
  order by m.online desc, m.last_seen desc nulls last, m.pseudo asc
  limit 500;
$$;

create or replace function public.members_counts()
returns table (online_now integer, total integer)
language sql
stable
security definer
set search_path = public
as $$
  -- Un seul parcours : le total et les présents sortent du même scan, donc
  -- les deux nombres ne peuvent pas décrire deux instants différents.
  select
    count(*) filter (where m.online)::int,
    count(*)::int
  from public.member_directory m;
$$;

create or replace function public.members_online()
returns table (user_id uuid, pseudo text, avatar text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.pseudo, m.avatar
  from public.member_directory m
  where m.online
  order by m.pseudo nulls last
  limit 100;
$$;

create or replace function public.home_community_stats()
returns table (spots_today integer, online_now integer, top_brand text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  -- L'accueil bat la présence en passant : c'est la première page ouverte,
  -- et sans ce coup l'utilisateur peut ne pas se voir dans son propre
  -- compteur pendant une minute.
  if v_user is not null then
    update public.profiles set last_seen = now() where user_id = v_user;
  end if;
  return query
    select
      (select count(*)::int from public.spots s
         where s.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
      (select count(*)::int from public.member_directory m where m.online),
      (select g.top_brand from public.global_stats_mv g);
end;
$$;

create or replace function public.top_spotters(limit_count integer default 500)
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
  order by xp desc, spots desc, m.pseudo asc
  limit greatest(limit_count, 1);
$$;

create or replace function public.city_leaderboard(p_city text, p_limit integer default 500)
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
  where coalesce(lower(trim(m.ville)), '') = lower(trim(p_city))
  order by xp desc, spots desc, m.pseudo asc
  limit greatest(p_limit, 1);
$$;

create or replace function public.countries_leaderboard()
returns table (country text, spotters integer, xp bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(m.country), ''), 'France') as country,
    count(*)::int                                   as spotters,
    coalesce(sum(m.xp_total), 0)::bigint            as xp
  from public.member_directory m
  group by 1
  order by xp desc, spotters desc, country asc;
$$;

create or replace function public.stories_feed()
returns table (
  user_id uuid, pseudo text, avatar text, online boolean,
  story_count integer, has_unseen boolean, latest_at timestamptz, is_me boolean
)
language sql
stable
set search_path = public
as $$
  select
    s.user_id,
    m.pseudo,
    m.avatar,
    m.online,
    count(*)::int as story_count,
    bool_or(v.user_id is null) as has_unseen,
    max(s.created_at) as latest_at,
    (s.user_id = auth.uid()) as is_me
  from public.stories s
  join public.member_directory m on m.user_id = s.user_id
  left join public.story_views v
    on v.story_id = s.id and v.user_id = auth.uid()
  where s.expires_at > now()
  group by s.user_id, m.pseudo, m.avatar, m.online
  order by (s.user_id = auth.uid()) desc, bool_or(v.user_id is null) desc, max(s.created_at) desc
  limit 50;
$$;

-- ── LE PROFIL PUBLIC LIT LA MÊME PRÉSENCE ──
-- Il ne l'affichait pas du tout : ouvrir le profil de quelqu'un vu « en
-- ligne » dans le panneau Membres ne disait rien de sa présence. Les deux
-- colonnes ajoutées ici sortent du même calcul que la liste, donc les deux
-- surfaces ne peuvent pas se contredire.
create or replace view public.profile_public as
  select
    p.user_id, p.pseudo, p.ville, p.avatar, p.title, p.instagram, p.dream_car,
    p.created_at, p.primary_spot_id,
    s.brand as primary_brand, s.model as primary_model, s.year as primary_year,
    s.color as primary_color, s.rarity as primary_rarity,
    s.photo_url as primary_photo_url, s.garage_render_url as primary_render_url,
    (p.last_seen is not null and p.last_seen >= now() - public.presence_window()) as online,
    case
      when p.last_seen is null then null
      else least(greatest(extract(epoch from (now() - p.last_seen)) / 60, 0), 1051200)::int
    end as minutes_ago
  from public.profiles p
  left join public.spots s
    on s.id = p.primary_spot_id and s.user_id = p.user_id;

-- ═══════ L'INSCRIPTION TERMINÉE EST UNE ACTIVITÉ ═══════
--
-- Trois membres inscrits le 2 octobre portaient `onboarding_completed = true`
-- et `last_seen = null` : terminer son inscription ne comptait pas comme un
-- signe de vie. Ils apparaissaient donc « hors ligne, jamais vu » à la
-- seconde même où ils venaient de rejoindre REVS.
--
-- Le battement client ne suffit pas à le garantir : il vit dans la mise en
-- page principale, qu'un parcours d'inscription peut quitter avant d'y
-- entrer. Posée en base, la règle tient quel que soit le chemin.
create or replace function public.mark_onboarding_as_activity()
returns trigger
language plpgsql
as $$
begin
  if new.onboarding_completed and not coalesce(old.onboarding_completed, false) then
    new.last_seen := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_onboarding_is_activity on public.profiles;
create trigger trg_onboarding_is_activity
  before update of onboarding_completed on public.profiles
  for each row execute function public.mark_onboarding_as_activity();

-- ── UNE ACTIVITÉ NE PEUT PAS ÊTRE DANS LE FUTUR ──
-- `authenticated` a le droit de mettre à jour sa propre ligne — c'est ce qui
-- permet au profil d'être modifiable. Rien n'empêchait donc d'y écrire
-- `last_seen = now() + 10 ans` et de rester « en ligne » indéfiniment sans
-- jamais ouvrir l'application. Le serveur ramène la valeur au présent.
create or replace function public.clamp_last_seen()
returns trigger
language plpgsql
as $$
begin
  if new.last_seen is not null and new.last_seen > now() then
    new.last_seen := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clamp_last_seen on public.profiles;
create trigger trg_clamp_last_seen
  before insert or update of last_seen on public.profiles
  for each row execute function public.clamp_last_seen();

-- ── RATTRAPAGE ──
-- Les membres dont l'inscription est terminée mais qui n'ont jamais eu de
-- battement. Leur seule activité connue est le moment où leur profil a été
-- créé : c'est ce qu'on inscrit, et rien de plus inventé que cela. Le
-- déclencheur ci-dessus fait qu'aucun compte futur n'aura besoin de ce
-- rattrapage.
update public.profiles
   set last_seen = created_at
 where onboarding_completed = true
   and last_seen is null;

-- ── DROITS ──
-- `anon` détenait INSERT / UPDATE / DELETE / TRUNCATE sur `profiles`. Aucune
-- policy ne les laisse passer, donc rien n'était exploitable — mais un droit
-- qui ne sert à rien n'a aucune raison d'exister, et il ne protège que tant
-- que personne n'ajoute une policy permissive par distraction.
revoke insert, update, delete, truncate, references, trigger on public.profiles from anon;

notify pgrst, 'reload schema';
