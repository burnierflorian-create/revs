-- ═══ DEUX FAILLES D'ÉLÉVATION DE PRIVILÈGE — FERMETURE ═══
--
-- Trouvées le 01/10/2026 en testant RÉELLEMENT le §13 du cahier des charges
-- (« l'utilisateur ne doit pas pouvoir s'approuver lui-même »). Les deux
-- PRÉEXISTAIENT à la candidature organisateur ; elles rendaient tout le
-- parcours décoratif, puisqu'on pouvait obtenir le rôle sans passer par lui.
--
-- Mesuré avec un vrai compte authentifié, avant correctif :
--   · UPDATE profiles SET role='organizer'  → accepté, rôle obtenu ;
--   · INSERT INTO events  par un simple utilisateur → accepté.

-- ─────────── FAILLE 1 : deux policies INSERT sur `events` ───────────
-- La migration 0002 avait posé « events insert organizer », qui exige
-- `role in ('organizer','admin')`. Mais elle n'avait pas supprimé l'ancienne
-- policy « Utilisateur peut créer des events », dont la seule condition est
-- `auth.uid() = organizer_id`.
--
-- Or deux policies PERMISSIVE pour la même commande se combinent par OU : il
-- suffit qu'UNE seule passe. La plus laxiste gagnait donc systématiquement, et
-- n'importe quel compte pouvait publier un événement.
--
-- 0002 ne pouvait pas la supprimer : elle listait trois noms, et pas
-- celui-là. C'est le genre d'oubli qu'aucune relecture ne rattrape — seul un
-- test avec un compte non-organisateur le montre.
drop policy if exists "Utilisateur peut créer des events" on public.events;

-- ─────────── FAILLE 2 : `profiles.role` était écrivable par son porteur ───────────
-- La policy « users update own profile » autorise `auth.uid() = user_id` sans
-- restriction de COLONNE. RLS raisonne par ligne, jamais par colonne : dès
-- qu'on peut modifier sa ligne, on peut modifier `role` — donc se nommer
-- organisateur soi-même.
--
-- La réponse n'est pas dans RLS mais dans les privilèges : on retire UPDATE
-- sur la table, puis on le rend colonne par colonne, sauf `role`. (Même
-- technique que la migration 0087 pour `spots.garage_render_url`.)
--
-- ⚠️ TOUTE NOUVELLE COLONNE de `profiles` devra être ajoutée à cette liste,
-- sinon elle naîtra en lecture seule pour le client.
revoke update on public.profiles from authenticated;
grant update (
  pseudo, ville, avatar, updated_at, is_public, last_seen,
  garage_brand, instagram, tiktok, onboarding_completed, country,
  force_relogin, language, dream_car, interests, discovery_source,
  preferred_brands, preferred_universes, ambition, age_confirmed,
  tutorial_completed
) on public.profiles to authenticated;

-- `role` n'est volontairement PAS dans la liste. Il ne change que par le
-- déclencheur `apply_organizer_decision()` (migration 0092), lui-même
-- déclenché par un changement de `status` que seule la clé de service peut
-- écrire. Le chemin vers le rôle organisateur est donc unique et traçable.

-- ── CE QUI N'EST PAS CORRIGÉ ICI, ET POURQUOI ──
-- `tier`, `xp_total`, `prestige`, `prestige_xp_base`, `title` et `invite_code`
-- sortent aussi de la liste ci-dessus — aucun code client ne les écrit, donc
-- rien ne casse — mais ce sont des colonnes d'économie (premium, XP), pas
-- d'autorisation organisateur. Elles étaient écrivables avant, elles ne le
-- sont plus ; c'est un effet de bord FAVORABLE de cette liste, pas une
-- refonte de l'économie XP, qui reste un chantier à part entière.

notify pgrst, 'reload schema';
