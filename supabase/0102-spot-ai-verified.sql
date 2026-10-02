-- ═══════ 0102 — PERSISTER LE SCEAU DE VÉRIFICATION DE L'IDENTIFICATION ═══════
--
-- ── LE TROU QUE CETTE COLONNE BOUCHE ──
-- `canRender()` (server/garage-visual.js) n'autorise un rendu que sur une
-- identité scellée, par l'un de deux moyens :
--   · `ident_locked` — un humain a saisi ou corrigé la fiche ;
--   · `verified`     — la contre-vérification d'identify-car l'a soutenue.
--
-- Le second n'existait que dans la RÉPONSE de l'API : rien ne l'écrivait en
-- base. Conséquence vérifiée sur les deux spots publiés le 02/10 — « Tesla
-- Model Y Juniper » et « Škoda Fabia III berline », tous deux correctement
-- identifiés et vérifiés par la chaîne — ils étaient refusés par le Garage
-- faute de trace. Seule une correction MANUELLE pouvait déverrouiller un
-- rendu, ce qui vide le sceau automatique de son sens.
--
-- ── POURQUOI UNE COLONNE ET NON UNE RELECTURE ──
-- Rejouer la vérification au moment du rendu coûterait un appel Sonnet par
-- spot et pourrait rendre un verdict différent du jour de la publication. Le
-- sceau appartient à l'instant de l'identification : on l'enregistre.

alter table public.spots
  add column if not exists ai_verified boolean not null default false;

comment on column public.spots.ai_verified is
  'true = la contre-vérification d''identify-car a soutenu la marque et le modèle. Avec ident_locked, c''est l''un des deux sceaux qu''exige canRender() avant de générer un rendu Garage.';

-- La migration 0093 a retiré UPDATE sur `spots` puis l'a redonné colonne par
-- colonne. Une colonne ajoutée après coup naît donc en lecture seule pour le
-- client : sans ce grant, l'insertion depuis NewSpot échouerait. C'est
-- exactement le piège déjà rencontré avec `primary_spot_id` en 0094.
grant insert (ai_verified), update (ai_verified) on public.spots to authenticated;

notify pgrst, 'reload schema';
