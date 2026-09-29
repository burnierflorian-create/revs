-- ════════════════════════════════════════════════════════════════════════
--  0073 — Publier `spots` en temps réel
-- ════════════════════════════════════════════════════════════════════════
--
-- CONSTAT (audit du 29/09/2026) : la publication `supabase_realtime` existe
-- mais ne contient AUCUNE table. Le canal écouté par la carte
-- (src/pages/Map.tsx:1589, `channel('public:spots')` sur postgres_changes)
-- ne se déclenchait donc jamais.
--
-- Conséquence exacte, et symptôme rapporté : l'auteur d'un spot le voyait
-- apparaître instantanément — non pas grâce au temps réel, mais grâce au pont
-- interne `onNewSpot` (src/lib/feedSync.ts), qui ne vit que dans son propre
-- onglet. Les autres utilisateurs retombaient sur le scrutin à 60 s de
-- Map.tsx, d'où l'impression qu'un spot n'était visible que pour son créateur.
--
-- CE QUI N'ÉTAIT PAS EN CAUSE, et qu'il ne faut donc pas « corriger » :
-- la politique RLS `spots public read` (USING true) et la requête de la carte
-- sont l'une et l'autre correctes. Testé en base : un spot frais est lu par
-- son auteur, par un autre compte authentifié et par un visiteur anonyme.
--
-- REPLICA IDENTITY vaut `d` (DEFAULT), ce qui suffit : le client ne lit que
-- `payload.new`. Passer en FULL n'aurait servi qu'à transporter les anciennes
-- valeurs sur UPDATE/DELETE, au prix d'un WAL plus lourd.
--
-- Le scrutin de 60 s est CONSERVÉ comme filet : il rattrape les spots qui
-- expirent, ceux qui entrent dans le cadre visible après un déplacement de
-- carte, et les éventuelles coupures de la connexion temps réel.

do $$
begin
  -- `alter publication … add table` échoue si la table y est déjà.
  -- Le test rend la migration rejouable sans erreur.
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'spots'
  ) then
    alter publication supabase_realtime add table public.spots;
  end if;
end
$$;
