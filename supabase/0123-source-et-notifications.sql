-- ═══════ D'OÙ VIENT LA PHOTO, ET QUI VEUT ÊTRE PRÉVENU ═══════

-- ── LA SOURCE DE LA PHOTO ──
-- Jusqu'ici NewSpot n'ouvrait QUE l'appareil photo (`capture="environment"`),
-- ce qui rendait la question sans objet : toute photo venait de la caméra.
-- Mais `capture` est une SUGGESTION — les navigateurs de bureau et plusieurs
-- navigateurs Android l'ignorent et ouvrent la galerie. La règle « une photo
-- de galerie ne crée pas de position » ne tenait donc que par chance.
--
-- On ne devine pas la source à partir des EXIF : une photo prise sur le
-- moment peut n'en avoir aucune, et une photo de galerie peut en avoir de
-- parfaites. C'est l'utilisateur qui la donne, en choisissant l'un des deux
-- boutons — et c'est la seule information fiable.
--
-- 'camera' par défaut : les 35 spots existants ont tous été publiés par le
-- chemin caméra, seul chemin qui existait. Les déclarer 'gallery' les ferait
-- disparaître de la carte sans raison.
alter table public.spots
  add column if not exists source text not null default 'camera';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'spots_source_check') then
    alter table public.spots add constraint spots_source_check
      check (source in ('camera', 'gallery'));
  end if;
end $$;

create index if not exists spots_source_idx on public.spots (source);

-- ── UNE PHOTO DE GALERIE N'A PAS DE POSITION ──
-- Appliqué en base, pas dans l'écran de publication : c'est la seule façon
-- qu'un appel direct à PostgREST ne puisse pas contourner la règle. Les
-- coordonnées sont effacées, pas refusées — la publication reste possible,
-- elle n'apparaît simplement pas sur la carte.
create or replace function public.strip_gallery_location()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'gallery' then
    new.lat := null;
    new.lng := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_strip_gallery_location on public.spots;
create trigger trg_strip_gallery_location
  before insert or update of source, lat, lng on public.spots
  for each row execute function public.strip_gallery_location();

comment on function public.strip_gallery_location() is
  'Une publication déclarée « galerie » n''a pas de position. Appliqué en '
  'base pour qu''un appel direct ne puisse pas la lui rendre — y compris à '
  'partir des EXIF, que REVS n''utilise de toute façon jamais pour situer un '
  'spot (seul le GPS en direct le fait).';

-- ── PRÉFÉRENCES DE NOTIFICATION ──
-- La table existait avec cinq interrupteurs (likes, comments, followers,
-- nearby, streak). On ajoute les catégories manquantes plutôt qu'une table
-- neuve : les cinq existants fonctionnent et sont déjà réglés par des
-- utilisateurs réels.
alter table public.notification_prefs
  -- Un nouveau spot publié par quelqu'un qu'on suit.
  add column if not exists following_spots boolean not null default true,
  -- Réactions — la catégorie est née après la table.
  add column if not exists reactions boolean not null default true,
  -- Événements : annonces, rappels.
  add column if not exists events boolean not null default true,
  -- Nouveautés REVS.
  add column if not exists revs_news boolean not null default true;

-- Sécurité et modération n'ont PAS d'interrupteur, délibérément : une
-- décision de modération ou une alerte de compte doit atteindre la personne
-- concernée. Pouvoir les couper reviendrait à pouvoir ignorer une sanction
-- sans jamais l'avoir lue.

-- ── LA PRÉFÉRENCE, LISIBLE PAR LE SERVEUR QUI ENVOIE ──
create or replace function public.wants_notification(p_user uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case p_type
       when 'likes'           then n.likes
       when 'comments'        then n.comments
       when 'followers'       then n.followers
       when 'nearby'          then n.nearby
       when 'streak'          then n.streak
       when 'reactions'       then n.reactions
       when 'following_spots' then n.following_spots
       when 'events'          then n.events
       when 'revs_news'       then n.revs_news
       -- Sécurité, compte, modération : toujours vrai, aucun interrupteur.
       else true
     end
     from public.notification_prefs n where n.user_id = p_user),
    -- Aucune ligne de préférences : tout est activé, comme à l'inscription.
    true
  );
$$;

grant execute on function public.wants_notification(uuid, text) to authenticated;

notify pgrst, 'reload schema';
