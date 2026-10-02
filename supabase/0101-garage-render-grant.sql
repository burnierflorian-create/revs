-- ═══════ 0101 — RENDRE claim_garage_render APPELABLE PAR LE SERVEUR ═══════
--
-- La migration 0100 révoquait les droits d'exécution « from public, anon,
-- authenticated » pour que personne ne puisse réserver une clé depuis le
-- navigateur. L'intention est bonne, l'exécution trop large : révoquer FROM
-- PUBLIC retire aussi le droit hérité par `service_role`, et PostgREST cesse
-- alors d'exposer la fonction — y compris au serveur, qui est pourtant le seul
-- à devoir l'appeler.
--
-- Vérifié : cinq appels concurrents renvoyaient tous
-- « Could not find the function public.claim_garage_render ».
--
-- On redonne donc le droit explicitement, et UNIQUEMENT à service_role.
grant execute on function public.claim_garage_render(text, text, text, text, int) to service_role;

notify pgrst, 'reload schema';
