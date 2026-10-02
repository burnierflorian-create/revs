-- ═══════ 0099 — FERMER L'ÉNUMÉRATION DU STORAGE ═══════
--
-- ── CE QUI ÉTAIT OUVERT ──
-- Vérifié le 02/10/2026 avec la seule clé anon, sans aucun compte :
--
--     anon.storage.from('spots').list('')     → 5 dossiers listés
--     anon.storage.from('avatars').list('')   → 1 dossier listé
--
-- N'importe qui pouvait donc énumérer le Storage, descendre dans le dossier
-- de chaque utilisateur, et récupérer TOUS les fichiers — y compris les
-- originaux d'avant floutage, qui n'ont jamais été supprimés (613 fichiers
-- relevés le 01/10). `photo_url` pointe vers la version protégée, mais
-- l'originale restait servie à son ancienne adresse, et cette adresse était
-- découvrable.
--
-- La cause est la policy `public read spot photos` : `for select to public
-- using (bucket_id = 'spots')`. Sur `storage.objects`, le SELECT gouverne À LA
-- FOIS la lecture des métadonnées et le LISTING. L'accorder à `public` pour
-- permettre l'affichage des photos ouvrait l'énumération par la même porte.
--
-- ── POURQUOI LA SUPPRIMER NE CASSE RIEN ──
-- Les quatre buckets sont `public = true` (vérifié). Le chemin
-- `/storage/v1/object/public/...` ne consulte PAS les policies : il sert le
-- fichier directement. L'application, elle, n'appelle jamais `.list()` —
-- relevé exhaustif de src/ : uniquement `getPublicUrl` et `upload`.
-- Les images continuent donc de s'afficher exactement comme avant ; seule
-- l'énumération disparaît.
--
-- On conserve un SELECT pour les utilisateurs authentifiés sur LEUR PROPRE
-- dossier : c'est ce dont a besoin quiconque voudra, plus tard, lister ou
-- nettoyer ses propres fichiers. Service_role continue de tout voir — il
-- contourne RLS — ce dont dépendent les scripts d'audit.

drop policy if exists "public read spot photos" on storage.objects;
drop policy if exists "public read avatars"     on storage.objects;

create policy "owners list own spot photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'spots'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "owners list own avatar"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ── PLAFOND DE TAILLE ET TYPES ACCEPTÉS ──
-- Les quatre buckets n'avaient AUCUNE limite (`file_size_limit: null`). Le
-- client compresse avant d'envoyer, mais rien n'oblige à passer par le client :
-- un compte authentifié pouvait téléverser des fichiers de n'importe quelle
-- taille et de n'importe quel type, directement par l'API. C'est un coût de
-- stockage non borné et un vecteur de dépôt de contenu arbitraire.
--
-- 15 Mo laisse une marge confortable au-dessus de ce que produit le pipeline
-- (une photo compressée fait ~300 Ko ; même une capture non compressée d'un
-- téléphone récent reste sous 10 Mo).
update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id in ('spots', 'avatars', 'car-renders', 'garage-renders');
