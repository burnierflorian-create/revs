-- ═══════ GARAGE : LA VOITURE AFFICHÉE REDEVIENT CELLE DE L'UTILISATEUR ═══════
--
-- CE QUE LE GARAGE MONTRAIT (audit du 30/09/2026)
-- `Showroom.imageFor()` choisissait l'image dans cet ordre :
--   1. spots.realistic_render_url   → JAMAIS renseigné (0 ligne sur 32)
--   2. car_renders (marque/modèle)  → 51 rendus PARTAGÉS : deux personnes
--      ayant spotté la même 911 voyaient la même image, et ce n'était la
--      voiture ni de l'une ni de l'autre
--   3. spots.photo_url              → la vraie photo, en dernier recours
--
-- Et `spots.garage_image_url` (30 lignes sur 32) contient des URL
-- **wikimedia.org**, écrites par api/car-info.ts, qui va chercher des photos
-- presse/constructeur sur Internet via CarImages puis Claude web_search.
--
-- Trois problèmes, pas seulement esthétiques :
--   · ce n'est pas la voiture de l'utilisateur ;
--   · ces images n'ont jamais traversé le floutage de plaques de REVS ;
--   · leur licence n'est pas maîtrisée, et elles sont chargées à chaud depuis
--     un domaine tiers.
--
-- CE QUE FAIT CETTE MIGRATION
-- Une colonne, une seule : le détourage de LA PHOTO DE L'UTILISATEUR. Rien
-- n'est supprimé — `garage_image_url` et `car_renders` restent en base, ils
-- sortent simplement du chemin d'affichage.

alter table public.spots
  add column if not exists garage_render_url text;

comment on column public.spots.garage_render_url is
  'PNG transparent obtenu en détourant spots.photo_url (version DÉJÀ floutée). '
  'Produit hors ligne par scripts/detour-spot-photos.mjs via '
  '@imgly/background-removal-node — aucun appel réseau, aucune image tierce. '
  'NULL = pas encore traité : le Garage retombe alors sur la photo elle-même, '
  'jamais sur une image de catalogue.';

-- Le backfill balaie les lignes non traitées : sans index il relit toute la
-- table à chaque reprise. Index partiel — seules les lignes NULL comptent.
create index if not exists spots_garage_render_todo_idx
  on public.spots (created_at)
  where garage_render_url is null;

-- ─────────── Écriture réservée au service_role ───────────
-- La colonne désigne un fichier du bucket `garage-renders`. Laisser un client
-- y écrire reviendrait à laisser n'importe qui faire pointer la vignette de
-- son garage vers une URL arbitraire.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'spots' and cmd = 'UPDATE'
  ) then
    raise notice
      '[0087] Des policies UPDATE existent sur spots : vérifier qu''aucune '
      'n''autorise garage_render_url en écriture client.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ─────────── Verrou au niveau COLONNE ───────────
-- La policy « spots update own » autorise un utilisateur à modifier SES lignes,
-- toutes colonnes confondues. Il pourrait donc faire pointer le rendu de son
-- garage vers une URL arbitraire — exactement le genre de porte qu'on vient de
-- fermer côté catalogue externe. RLS raisonne par ligne ; ce privilège-ci
-- raisonne par colonne, et c'est ce qu'il faut ici.
--
-- On révoque puis on ré-accorde colonne par colonne, en omettant
-- `garage_render_url` : seul le service_role (le script de détourage) l'écrit.
revoke update on public.spots from authenticated;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'spots'
     and column_name <> 'garage_render_url';

  execute format('grant update (%s) on public.spots to authenticated', cols);
end $$;

notify pgrst, 'reload schema';
