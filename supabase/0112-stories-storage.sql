-- ═══════ 0112 — STOCKAGE DES STORIES ═══════
--
-- Mêmes règles que les photos de spots (bucket `spots`) : le premier segment
-- du chemin est l'identifiant du propriétaire, et c'est lui qui autorise.
-- Un fichier déposé sous `<uid>/…` n'est modifiable et supprimable que par
-- `<uid>`, quelle que soit l'URL devinée.
--
-- Le bucket est PUBLIC en lecture, comme `spots` et `avatars` : l'image doit
-- s'afficher dans un <img> sans jeton. La confidentialité d'une story tient
-- à sa LIGNE (policy `read visible stories`), pas à son fichier — une URL de
-- stockage ne se devine pas, mais elle ne se protège pas non plus.

drop policy if exists "users upload own story media" on storage.objects;
create policy "users upload own story media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners list own story media" on storage.objects;
create policy "owners list own story media" on storage.objects
  for select to authenticated
  using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update own story media" on storage.objects;
create policy "users update own story media" on storage.objects
  for update to authenticated
  using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own story media" on storage.objects;
create policy "users delete own story media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
