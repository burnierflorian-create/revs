-- ════════════════════════════════════════════════════════════════════════
--  0075 — Mémoire des articles déjà analysés
-- ════════════════════════════════════════════════════════════════════════
--
-- CONSTAT (diagnostic du 25/09/2026, docs/CRONS_PAUSE.md §1.2)
-- `api/fetch-news.ts` déduplique les candidats contre la table `news`. Mais
-- `news` est écrêtée à 50 lignes après chaque exécution, et la fenêtre de
-- candidature des flux RSS est de 7 jours : un article analysé puis REJETÉ
-- n'est enregistré nulle part, et repasse donc par Claude chaque jour tant
-- qu'il reste dans la fenêtre — jusqu'à sept fois pour le même verdict.
--
-- Cette table est la mémoire manquante. Un URL vu une fois ne repart jamais
-- vers l'IA, quel qu'ait été le verdict.
--
-- ── POURQUOI ENREGISTRER AUSSI LES ARTICLES ACCEPTÉS ──
-- On pourrait ne garder que les rejets, puisque les acceptés atterrissent
-- dans `news`. Mais `news` est écrêtée : un article accepté puis évincé
-- redeviendrait « inconnu » et serait re-analysé. Enregistrer tout le monde
-- est plus simple ET strictement plus sûr ; `verdict` garde la distinction
-- pour le diagnostic.
--
-- ── AUCUNE POLITIQUE RLS, ET C'EST VOULU ──
-- RLS activée + zéro politique = personne ne lit ni n'écrit depuis un client.
-- Seule la clé service_role y accède, comme pour `ai_usage` et
-- `api_abuse_attempts`. C'est un compteur anti-gaspillage : il ne doit pas
-- être contournable depuis le navigateur.

create table if not exists public.news_seen (
  url     text primary key,
  seen_at timestamptz not null default now(),
  -- 'kept'      → inséré dans `news`
  -- 'rejected'  → analysé par Claude, écarté (hors sujet, résumé trop court…)
  -- 'prefilter' → écarté AVANT l'IA (pas d'image, titre commercial)
  verdict text
);

comment on table public.news_seen is
  'URL déjà passés par le collecteur d''actualités. Empêche de repayer une analyse IA sur un article déjà jugé. Purgé à 30 jours par api/fetch-news.ts.';

alter table public.news_seen enable row level security;

-- Purge : le collecteur supprime les lignes de plus de 30 jours à chaque
-- exécution. L'index rend ce balayage instantané, et il n'y a pas de raison
-- de garder une mémoire plus longue que la fenêtre de candidature (7 jours)
-- multipliée par une marge confortable.
create index if not exists news_seen_seen_at_idx
  on public.news_seen (seen_at);
