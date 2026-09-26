-- ─────────────── Cache des fiches expert, par MODÈLE et non par spot ───────────────
--
-- `spots.car_info` est un cache par LIGNE. Dix personnes qui photographient la
-- même Ferrari 488 GTB déclenchent dix fois le même appel Sonnet + jusqu'à
-- cinq recherches web — environ 0,10 $ à chaque fois, pour un résultat
-- identique. C'est le poste le plus cher du pipeline IA.
--
-- Cette table déplace le cache au niveau du modèle. `spots.car_info` reste
-- alimenté pour ne rien casser en lecture (SpotDetail lit toujours le spot).
--
-- Apply: node scripts/apply-rls.mjs supabase/0070-car-info-cache.sql

create table if not exists public.car_info_cache (
  -- Clé « marque|modèle|année », normalisée côté serveur. Même motif que
  -- car_specs (migration 0036), qui a fait ses preuves ici.
  --
  -- À noter : une contrainte UNIQUE (brand, model, coalesce(year,'')) n'est
  -- pas possible en PostgreSQL — une contrainte de table n'accepte pas
  -- d'expression. Il faudrait un index unique sur expression. Le slug en clé
  -- primaire évite le problème et rend la clé lisible.
  slug        text primary key,
  brand       text not null,
  model       text not null,
  year        integer,
  -- {"name","engine","horsepower","torque","zero_to_100",
  --  "top_speed","msrp_eur","production","history"}
  -- Contenu DIFFÉRENT de car_specs, qui stocke les 5 champs du dos de carte.
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists car_info_cache_updated_at_idx
  on public.car_info_cache (updated_at desc);

-- Lecture publique : le contenu est une fiche technique de voiture, sans
-- donnée personnelle. Aucune policy d'écriture → service_role uniquement,
-- comme car_specs et car_catalog.
alter table public.car_info_cache enable row level security;

drop policy if exists "car info cache public read" on public.car_info_cache;
create policy "car info cache public read"
  on public.car_info_cache for select using (true);

notify pgrst, 'reload schema';

-- ─────────── Amorçage depuis l'existant ───────────
-- 14 spots portent déjà une fiche `car_info`. On la promeut au niveau du
-- modèle pour que le cache démarre chaud plutôt que vide. En cas de doublons
-- (même modèle sur plusieurs spots), `distinct on` retient la fiche la plus
-- récente.
insert into public.car_info_cache (slug, brand, model, year, data)
select
  lower(regexp_replace(s.brand, '[^a-zA-Z0-9]+', '-', 'g')) || '|' ||
  lower(regexp_replace(s.model, '[^a-zA-Z0-9]+', '-', 'g')) || '|' ||
  coalesce(s.year::text, 'na'),
  s.brand, s.model, s.year, s.car_info
from (
  select distinct on (
    lower(regexp_replace(brand, '[^a-zA-Z0-9]+', '-', 'g')),
    lower(regexp_replace(model, '[^a-zA-Z0-9]+', '-', 'g')),
    coalesce(year::text, 'na')
  ) brand, model, year, car_info, created_at
  from public.spots
  where car_info is not null
  order by
    lower(regexp_replace(brand, '[^a-zA-Z0-9]+', '-', 'g')),
    lower(regexp_replace(model, '[^a-zA-Z0-9]+', '-', 'g')),
    coalesce(year::text, 'na'),
    created_at desc
) s
on conflict (slug) do nothing;

-- ─────────── Note ───────────
-- Les tirets de tête et de queue ne sont PAS retirés par ce regexp, alors que
-- carInfoSlug() côté serveur les enlève. Pour les marques et modèles réels,
-- qui commencent et finissent par une lettre ou un chiffre, les deux formes
-- coïncident. Un écart resterait sans gravité : la clé amorcée ne serait
-- simplement jamais lue, et le modèle repasserait une fois par l'IA.
