-- ─────────────── Précision GPS des spots : arrondi à 3 décimales ───────────────
--
-- `spots` est en lecture publique (`spots public read using (true)`), donc
-- `lat`/`lng` sont lisibles par tout porteur de la clé anonyme, sans compte.
-- Stockées en précision pleine, plusieurs spots d'un même utilisateur au même
-- endroit désignent son domicile au mètre près.
--
-- 3 décimales ≈ 111 m : assez fin pour situer un quartier sur la carte, trop
-- grossier pour désigner une adresse.
--
-- Défense en profondeur : l'arrondi est déjà appliqué côté client
-- (roundCoord() dans src/lib/geo.ts), mais un client peut être contourné —
-- un INSERT PostgREST direct enverrait la position exacte. Ce trigger la
-- réapplique en base, où rien ne le contourne.
--
-- ⚠️ ATTENTION : le backfill du bas est IRRÉVERSIBLE. La précision d'origine
--    des 29 spots existants est définitivement perdue. Faire une sauvegarde
--    avant si tu veux pouvoir revenir en arrière.
--
-- Apply: node scripts/apply-rls.mjs supabase/0069-round-spot-coords.sql

-- ─────────── Trigger ───────────
-- Noms de colonnes : `lat` et `lng` en double precision. (La table n'a pas de
-- colonnes `latitude`/`longitude` — une migration écrite sur ces noms-là
-- échouerait.)
create or replace function public.round_spot_coords()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null then
    new.lat := round(new.lat::numeric, 3)::double precision;
  end if;
  if new.lng is not null then
    new.lng := round(new.lng::numeric, 3)::double precision;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_round_spot_coords on public.spots;
create trigger trg_round_spot_coords
  before insert or update of lat, lng on public.spots
  for each row execute function public.round_spot_coords();

-- Note sur l'ordre d'exécution : PostgreSQL déclenche les triggers BEFORE
-- d'une même table par ordre alphabétique de nom. Ici
-- `trg_enforce_spot_daily_quota` (migration 0068) passe avant
-- `trg_round_spot_coords`. Les deux touchent des colonnes disjointes — quota
-- et `created_at` d'un côté, `lat`/`lng` de l'autre — donc l'ordre est sans
-- conséquence.

-- ─────────── Backfill des spots existants ───────────
-- `lat` et `lng` sont NOT NULL, donc pas de garde sur la nullité.
update public.spots
   set lat = round(lat::numeric, 3)::double precision,
       lng = round(lng::numeric, 3)::double precision
 where lat <> round(lat::numeric, 3)::double precision
    or lng <> round(lng::numeric, 3)::double precision;

notify pgrst, 'reload schema';

-- ─────────── Effets attendus ───────────
--
-- 1. CARTE — Mapbox affiche les spots sans changement visible à l'échelle
--    d'une ville. En revanche, deux spots distants de moins de ~111 m
--    tombent désormais sur des coordonnées IDENTIQUES et leurs marqueurs se
--    superposent exactement. Si cela devient gênant, la réponse est un
--    décalage visuel (clustering ou jitter d'affichage), pas un retour à la
--    précision pleine.
--
-- 2. RECHERCHES DE PROXIMITÉ — radar (10 km), événement proche (5 km),
--    notifications de marque (50 km) : une granularité de 111 m est sans
--    effet mesurable sur ces rayons.
--
-- 3. ANTI-FRAUDE — le contrôle de dérive GPS entre l'EXIF de la photo et la
--    position réelle reste en PRÉCISION PLEINE côté client, avant insertion.
--    L'arrondir aurait ajouté jusqu'à ~78 m de dérive artificielle sur un
--    seuil de 300 m, donc des rejets injustifiés.
