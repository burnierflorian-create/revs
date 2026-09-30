-- ═══════ DÉBLOCAGE DE BADGE : UN ÉVÉNEMENT, UNE SEULE FOIS ═══════
--
-- CE QUI EXISTAIT
-- `BadgeUnlockWatcher` comparait les badges du moment à une liste conservée
-- dans `localStorage`. Ça marche — mais par APPAREIL : le même badge rejouait
-- son animation sur le téléphone puis sur l'ordinateur. Et aucune notification
-- n'était créée : l'information disparaissait avec l'animation.
--
-- CETTE FONCTION est l'événement unique demandé : elle crée la notification
-- si elle n'existe pas, et renvoie `true` UNIQUEMENT à ce moment-là. C'est ce
-- booléen qui autorise l'animation. L'index unique `(user_id, dedupe_key)`
-- garantit qu'un seul appareil l'obtiendra, quel que soit l'ordre d'arrivée.
--
-- ⚠️ PORTÉE DE LA VÉRIFICATION — À DIRE CLAIREMENT
-- Les badges sont aujourd'hui calculés CÔTÉ CLIENT (src/lib/badges.ts) : il
-- n'existe aucune table de badges ni de moteur SQL. Cette fonction ne peut donc
-- pas vérifier que le badge est mérité ; elle se contente de garantir l'unicité.
-- Un client forgé pourrait s'offrir une notification décorative.
--
-- Le risque est volontairement accepté, et il est cosmétique : aucune XP,
-- aucun niveau, aucune récompense n'en découle — le brief l'exige (§7), et
-- `award_xp_spot()` reste la seule source d'XP. Porter le moteur de badges en
-- SQL serait la vraie réponse, mais c'est un chantier à part.
create or replace function public.claim_badge_unlock(
  p_slug  text,
  p_title text,
  p_body  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new  int;
begin
  if v_user is null or coalesce(p_slug, '') = '' then
    return false;
  end if;

  insert into public.notifications (user_id, type, title, body, link, dedupe_key, meta)
  values (
    v_user, 'badge_unlock', p_title, p_body, '/badges',
    'badge:' || p_slug,
    jsonb_build_object('slug', p_slug)
  )
  on conflict (user_id, dedupe_key) do nothing;

  get diagnostics v_new = row_count;
  -- true = c'est CETTE session qui vient de créer l'événement. Les autres
  -- appareils recevront false et n'animeront rien.
  return v_new = 1;
end
$$;

grant execute on function public.claim_badge_unlock(text, text, text) to authenticated;
revoke all on function public.claim_badge_unlock(text, text, text) from anon;

notify pgrst, 'reload schema';
