-- ═══════ POURQUOI AUCUN PROFIL NE POUVAIT PLUS ÊTRE ENREGISTRÉ ═══════
--
-- `require_age_confirmed()` (migration 0072) est un déclencheur BEFORE INSERT
-- sur `profiles`. Il refuse la création d'un profil dont l'âge n'a pas été
-- déclaré. C'est juste, et ça doit le rester.
--
-- Mais les Réglages enregistrent le profil par un UPSERT :
--
--     .upsert({ user_id, avatar }, { onConflict: 'user_id' })
--
-- PostgREST le traduit en `INSERT ... ON CONFLICT (user_id) DO UPDATE`. Or
-- Postgres exécute les déclencheurs BEFORE INSERT sur la ligne PROPOSÉE,
-- avant de savoir qu'elle entrera en conflit. Cette ligne proposée ne porte
-- que `user_id` et `avatar` : `age_confirmed` y prend sa valeur par défaut,
-- `false`. Le déclencheur lève donc « Âge minimum non confirmé » — pour un
-- compte dont la ligne stockée porte pourtant `age_confirmed = true`.
--
-- Vérifié compte par compte :
--     age_confirmed du profil      : true
--     UPSERT sans age_confirmed    : ✗ Âge minimum non confirmé.
--     UPSERT avec age_confirmed    : ✓
--     UPDATE simple                : ✓
--
-- Conséquence réelle : AUCUN utilisateur ne pouvait enregistrer sa photo, son
-- pseudo, sa ville ni sa voiture de rêve. L'échec arrivait après la fermeture
-- du recadrage, donc l'écran revenait au profil avec l'ancienne image — ce
-- qui se lit comme « la nouvelle photo n'est pas prise en compte ».
--
-- ── LA CORRECTION, EN DEUX ENDROITS ──
-- Côté client, les Réglages passent à `.update()` : la ligne existe toujours,
-- `handle_new_user()` la crée à l'inscription. C'est la vraie erreur.
--
-- Ici, le filet : si une ligne existe DÉJÀ pour cet utilisateur, l'âge a été
-- déclaré au moment de sa création — la laisser passer n'affaiblit rien. Le
-- garde-fou continue de refuser toute création de profil sans déclaration,
-- ce pour quoi il a été écrit.
create or replace function public.require_age_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.age_confirmed is not true
     and not exists (
       select 1 from public.profiles p where p.user_id = new.user_id
     )
  then
    raise exception 'Âge minimum non confirmé.'
      using hint = 'age_not_confirmed';
  end if;
  return new;
end;
$$;

comment on function public.require_age_confirmed() is
  'Refuse la CRÉATION d''un profil sans déclaration d''âge. Laisse passer la '
  'branche conflit d''un UPSERT sur un profil existant : l''âge y a déjà été '
  'déclaré, et le déclencheur BEFORE INSERT voit sinon la valeur par défaut '
  'de la ligne proposée plutôt que celle de la ligne stockée.';

notify pgrst, 'reload schema';
