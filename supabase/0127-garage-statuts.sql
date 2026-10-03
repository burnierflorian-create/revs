-- ═══════ GARAGE : DIRE QU'UN RENDU EST DOUTEUX ═══════
--
-- `garage_renders.status` ne connaissait qu'une valeur : 'ready'. Les 46
-- lignes la portent toutes. Un rendu au mauvais angle, une voiture coupée ou
-- une génération échouée étaient donc indiscernables d'un rendu parfait —
-- et rien ne permettait de les retrouver.
--
-- Trois classes, telles que demandées :
--   ready        — contrôlée, utilisable (classe A)
--   needs_review — produite, mais un défaut a été détecté (classe B)
--   failed       — impossible de garantir la qualité après plusieurs
--                  tentatives, ou génération en erreur (classe C)
--
-- ── POURQUOI UN COMPTEUR DE TENTATIVES ──
-- Sans lui, un modèle que le moteur n'arrive pas à rendre serait régénéré à
-- chaque passage de backfill. À 0,067 $ l'image, une boucle sur un seul
-- modèle coûte plus cher que tout le reste du Garage.
alter table public.garage_renders
  add column if not exists review_reason text,
  add column if not exists attempts integer not null default 1,
  add column if not exists last_attempt_at timestamptz;

alter table public.garage_renders drop constraint if exists garage_renders_status_check;
alter table public.garage_renders add constraint garage_renders_status_check
  check (status in ('pending', 'ready', 'needs_review', 'failed'));

-- Au-delà de ce nombre de tentatives, on arrête et on demande un humain.
-- Trois : la première peut rater l'angle, la deuxième le corrige
-- habituellement, la troisième tranche. Au-delà, c'est l'identité du modèle
-- qui est en cause, pas le moteur de rendu.
create or replace function public.garage_max_attempts()
returns integer language sql immutable parallel safe as $$ select 3 $$;

/** Les rendus qu'un humain doit regarder, avec de quoi décider. */
create or replace function public.garage_needs_review()
returns table (
  cache_key text, brand text, model text, colour text,
  status text, review_reason text, attempts integer,
  render_url text, last_attempt_at timestamptz,
  spots integer, users integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.cache_key, g.brand, g.model, g.colour,
    g.status, g.review_reason, g.attempts,
    g.render_url, g.last_attempt_at,
    -- Combien de spots et de personnes ce rendu concerne : un modèle vu par
    -- dix membres mérite d'être arbitré avant un modèle vu une fois.
    (select count(*)::int from public.spots s
      where lower(trim(s.brand)) = lower(trim(g.brand))
        and lower(trim(s.model)) = lower(trim(g.model))),
    (select count(distinct s.user_id)::int from public.spots s
      where lower(trim(s.brand)) = lower(trim(g.brand))
        and lower(trim(s.model)) = lower(trim(g.model)))
  from public.garage_renders g
  where g.status in ('needs_review', 'failed')
  order by g.status, g.attempts desc, g.cache_key;
$$;

grant execute on function public.garage_needs_review() to authenticated;

-- Les 46 rendus existants restent 'ready' : ils ont tous passé le contrôle
-- d'angle du backfill. On ne les déclasse pas sans raison.
update public.garage_renders
   set last_attempt_at = coalesce(last_attempt_at, created_at)
 where last_attempt_at is null;

notify pgrst, 'reload schema';
