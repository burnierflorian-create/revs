-- ═══════════════ VERROU ATOMIQUE : UNE GÉNÉRATION D'ACTUS PAR JOUR ═══════════════
--
-- CE QUI EXISTAIT
-- `api/fetch-news.ts` lisait `news_meta.last_fetched_at`, comparait le jour
-- parisien, puis générait. Lecture PUIS écriture, séparées par tout le pipeline
-- (plusieurs dizaines de secondes d'appels IA). Deux invocations rapprochées —
-- un cron relancé par Vercel, deux entrées de planification qui se chevauchent,
-- un appel manuel doublé — lisaient toutes les deux « pas encore aujourd'hui »
-- et généraient toutes les deux. Le verrou ne verrouillait rien : il constatait.
--
-- CE QUE FAIT CELUI-CI
-- La réservation du jour devient une SEULE instruction SQL. `INSERT … ON
-- CONFLICT DO UPDATE` verrouille la ligne `singleton` : le deuxième appelant
-- attend le premier, puis réévalue la condition — et repart les mains vides.
-- Le gagnant est celui qui obtient `row_count = 1`. Il n'y a pas de fenêtre
-- entre la vérification et la pose du verrou, parce qu'il n'y a plus deux
-- opérations.
--
-- POURQUOI UNE COLONNE SÉPARÉE
-- `last_fetched_at` reste l'horodatage AFFICHÉ (« Mis à jour il y a 3 h »),
-- posé en fin d'exécution. `last_run_day` est le VERROU, posé au début. Les
-- confondre obligerait à choisir entre un verrou qui arrive trop tard et une
-- étiquette qui ment sur l'heure réelle.
--
-- EN CAS D'ÉCHEC : `release_news_day()` rend la journée. Un passage qui meurt
-- à mi-chemin ne condamne donc pas les actus jusqu'au lendemain.

alter table public.news_meta
  add column if not exists last_run_day date;

-- Reprise de l'existant : si une génération a déjà eu lieu aujourd'hui (heure
-- de Paris), la journée est considérée comme consommée. Sans cela, le premier
-- déploiement rouvrirait la porte une fois de plus le jour même.
update public.news_meta
   set last_run_day = (last_fetched_at at time zone 'Europe/Paris')::date
 where id = 'singleton'
   and last_run_day is null
   and last_fetched_at is not null;

-- ─────────────────────────── RÉSERVER LA JOURNÉE ───────────────────────────
-- Renvoie true UNE SEULE FOIS par jour parisien, au premier appelant.
create or replace function public.claim_news_day(p_day date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed int;
begin
  insert into public.news_meta (id, last_run_day)
       values ('singleton', p_day)
  on conflict (id) do update
          set last_run_day = excluded.last_run_day
        where news_meta.last_run_day is null
           or news_meta.last_run_day < excluded.last_run_day;

  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end
$$;

-- ────────────────────────── RENDRE LA JOURNÉE ──────────────────────────
create or replace function public.release_news_day(p_day date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.news_meta
     set last_run_day = null
   where id = 'singleton'
     and last_run_day = p_day;
$$;

-- Ces deux fonctions décident si REVS dépense des crédits Anthropic. Elles
-- n'ont rien à faire dans les mains d'un visiteur : seule la clé de service,
-- utilisée par la fonction serverless du cron, peut les appeler.
revoke all on function public.claim_news_day(date)   from public, anon, authenticated;
revoke all on function public.release_news_day(date) from public, anon, authenticated;
grant execute on function public.claim_news_day(date)   to service_role;
grant execute on function public.release_news_day(date) to service_role;
