-- ═══════ 0100 — CACHE DES RENDUS GARAGE VISUAL ═══════
--
-- ── CE QUE CETTE TABLE EMPÊCHE ──
-- Sans elle, dix personnes photographiant la même Tesla Model Y blanche
-- déclenchent dix générations à 0,067 $ pour produire dix fois la même image.
-- Le rendu ne dépend que de l'identité du véhicule et de sa couleur : il est
-- donc partageable, et doit l'être.
--
-- La clé est `marque|modèle|famille-de-couleur|version-de-prompt`, construite
-- par `cacheKey()` dans server/garage-visual.js. La version du prompt en fait
-- partie délibérément : changer le prompt change le rendu, et réutiliser une
-- image produite par une consigne antérieure donnerait un showroom
-- hétérogène — exactement ce que la v3 vient de corriger.
--
-- ── POURQUOI UN VERROU ATOMIQUE ──
-- Deux personnes publiant la même voiture à la même seconde déclencheraient
-- deux générations concurrentes : on paierait deux fois et l'une écraserait
-- l'autre. `claim_garage_render()` donne le droit de générer à UN SEUL
-- appelant, par un INSERT ... ON CONFLICT dont la clause WHERE ne retient que
-- les lignes réellement disponibles. C'est le même motif que
-- `claim_brand_content` (0095) et `claim_f1_entity` (0096), éprouvé.
--
-- Une réservation est réputée abandonnée au bout de 2 minutes : une génération
-- dure ~10 s, et sans cette péremption un processus tué laisserait la clé
-- verrouillée pour toujours.

create table if not exists public.garage_renders (
  cache_key   text primary key,
  brand       text,
  model       text,
  colour      text,
  -- 'pending' pendant la génération, 'ready' quand l'image est en ligne.
  -- Pas d'état 'failed' : un échec supprime la ligne, ce qui rend la clé
  -- immédiatement réessayable au lieu de la condamner.
  status      text not null default 'pending' check (status in ('pending', 'ready')),
  render_url  text,
  -- Version du prompt ayant produit l'image. Redondant avec la clé, mais
  -- lisible : il permet de retrouver « tous les rendus faits en v2 » sans
  -- analyser la chaîne.
  version     int not null default 1,
  claimed_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists garage_renders_status_idx
  on public.garage_renders (status, claimed_at desc);

alter table public.garage_renders enable row level security;

-- ── LECTURE PUBLIQUE, ÉCRITURE SERVEUR ──
-- L'image finale est servie depuis un bucket public : son URL n'est pas un
-- secret. En revanche personne ne doit pouvoir réserver, écrire ou invalider
-- une entrée depuis le navigateur — sans quoi n'importe qui pourrait épuiser
-- le budget en réservant des clés, ou rattacher une image de son choix à un
-- véhicule. Le service_role contourne RLS ; aucune policy d'écriture n'est
-- donc nécessaire.
drop policy if exists "garage renders public read" on public.garage_renders;
create policy "garage renders public read"
  on public.garage_renders for select to public using (true);

-- ── LE VERROU ──
-- Renvoie :
--   'ready'   → une image existe, l'appelant la réutilise. Aucune dépense.
--   'pending' → quelqu'un d'autre génère en ce moment. L'appelant s'abstient.
--   'claimed' → l'appelant a le droit de générer, et lui seul.
create or replace function public.claim_garage_render(
  p_key     text,
  p_brand   text,
  p_model   text,
  p_colour  text,
  p_version int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
  v_status text;
  v_url text;
begin
  insert into public.garage_renders as g
    (cache_key, brand, model, colour, status, version, claimed_at)
  values
    (p_key, p_brand, p_model, p_colour, 'pending', p_version, now())
  on conflict (cache_key) do update
     set claimed_at = now(),
         version    = excluded.version
   where g.status <> 'ready'
     and g.claimed_at < now() - interval '2 minutes';

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return 'claimed';
  end if;

  select status, render_url into v_status, v_url
    from public.garage_renders where cache_key = p_key;

  if v_status = 'ready' and v_url is not null then
    return 'ready';
  end if;
  return 'pending';
end;
$$;

revoke all on function public.claim_garage_render(text, text, text, text, int) from public, anon, authenticated;

notify pgrst, 'reload schema';
