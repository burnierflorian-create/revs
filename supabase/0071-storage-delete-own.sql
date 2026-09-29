-- ════════════════════════════════════════════════════════════════════════
--  0071 — Droit de suppression de ses propres fichiers (storage)
-- ════════════════════════════════════════════════════════════════════════
--
-- CONSTAT (audit du 28/09/2026) : storage.objects portait des politiques
-- SELECT (public), INSERT et UPDATE (propriétaire), mais AUCUNE politique
-- DELETE. Un utilisateur ne pouvait donc pas effacer ses propres photos, et
-- l'application n'avait aucun moyen de le faire en son nom : supprimer un
-- spot aurait laissé l'image en ligne, à une URL publique.
--
-- Les deux buckets rangent les fichiers sous `{user_id}/…` :
--   spots   → {user_id}/{timestamp}.jpg   (NewSpot.tsx)
--   avatars → {user_id}/avatar.jpg        (Settings.tsx)
--
-- La politique s'appuie sur ce préfixe, exactement comme les politiques
-- UPDATE déjà en place. `storage.foldername(name)[1]` est le premier segment
-- du chemin : le comparer à auth.uid() garantit qu'un utilisateur ne peut
-- viser que son propre dossier, quel que soit le chemin qu'il envoie.
--
-- PÉRIMÈTRE : le bucket `car-renders` est délibérément exclu. C'est une
-- bibliothèque partagée, alimentée par un script de maintenance et rangée par
-- marque/modèle — elle ne contient aucune donnée personnelle et ne doit pas
-- être effaçable depuis un client.

drop policy if exists "users delete own spot photos" on storage.objects;
create policy "users delete own spot photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'spots'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "users delete own avatar" on storage.objects;
create policy "users delete own avatar"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
