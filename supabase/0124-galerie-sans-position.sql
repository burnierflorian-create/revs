-- ═══════ UN SPOT DE GALERIE N'A PAS DE POSITION — VRAIMENT ═══════
--
-- La migration 0123 efface lat/lng pour une publication déclarée « galerie ».
-- Mais les deux colonnes étaient NOT NULL : l'insertion échouait donc, et
-- aucune publication galerie n'était possible. Vérifié en production :
--
--   spot galerie créé ✗ — null value in column "lat" violates not-null
--
-- Rendre les colonnes nullables n'est pas un contournement : c'est le modèle
-- juste. Une photo qu'on n'a pas prise sur le moment n'a pas de lieu, et
-- stocker un 0 ou la position de l'utilisateur serait précisément ce que la
-- règle interdit.
alter table public.spots alter column lat drop not null;
alter table public.spots alter column lng drop not null;

-- Les lecteurs côté carte écartent déjà une position invalide sans se
-- rabattre sur un point par défaut (`validLngLat`). Les fonctions SQL qui
-- lisent lat/lng le font dans des comparaisons de distance, où NULL rend la
-- comparaison fausse — le spot est simplement hors rayon, ce qui est le
-- comportement voulu pour une publication sans lieu.

-- Garde-fou inverse : une publication CAMÉRA, elle, doit avoir une position.
-- Sans cela, une erreur du client produirait un spot caméra invisible sur la
-- carte sans que rien ne le signale.
alter table public.spots drop constraint if exists spots_camera_needs_position;
alter table public.spots add constraint spots_camera_needs_position
  check (source <> 'camera' or (lat is not null and lng is not null));

notify pgrst, 'reload schema';
