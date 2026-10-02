-- ═══════ 0103 — INTERDIRE LES COORDONNÉES IMPOSSIBLES ═══════
--
-- ── CE QUI ÉTAIT POSSIBLE ──
-- `lat` et `lng` sont NOT NULL en double precision, mais rien ne bornait
-- leurs valeurs. Vérifié le 02/10/2026 en l'insérant réellement : un spot à
-- `lat = 999, lng = -4000` est accepté sans broncher, puis diffusé par
-- Realtime à tous les clients.
--
-- Côté carte, Mapbox projette alors une position impossible et dépose le
-- marqueur dans le COIN HAUT-GAUCHE du conteneur — le symptôme signalé. Une
-- garde client vient d'être posée (validLngLat dans Map.tsx) et l'omet
-- désormais ; cette contrainte-ci empêche la ligne d'exister tout court.
--
-- Les deux sont utiles et ne font pas double emploi : la base protège la
-- donnée, le client protège l'affichage contre tout ce qui arriverait par un
-- autre chemin.
--
-- ── CE QUE CETTE MIGRATION NE FAIT PAS ──
-- Elle ne touche NI la précision des coordonnées, NI l'arrondi appliqué à la
-- publication, NI la durée de vie des spots. Elle borne, elle n'arrondit pas.
--
-- Les 35 lignes existantes ont été vérifiées : toutes dans les bornes. La
-- contrainte est donc posée sans NOT VALID.

alter table public.spots
  drop constraint if exists spots_coords_in_range;

alter table public.spots
  add constraint spots_coords_in_range
  check (lat >= -90 and lat <= 90 and lng >= -180 and lng <= 180);

comment on constraint spots_coords_in_range on public.spots is
  'Bornes géographiques. Sans elle, un spot à lat=999 était accepté puis diffusé par Realtime, et son marqueur atterrissait dans le coin haut-gauche de la carte.';
