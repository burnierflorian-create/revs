-- ═══════ 0105 — UN COMPTE CRÉÉ EST UN PROFIL CRÉÉ ═══════
--
-- ── LE DÉFAUT, ET POURQUOI IL ÉTAIT INVISIBLE ──
-- Six comptes `auth.users` sur dix-sept n'avaient aucune ligne dans
-- `profiles`. Deux d'entre eux venaient de terminer leur inscription le
-- 02/10 et utilisaient l'application : ils n'existaient nulle part pour
-- « Global / Membres », qui lit `profiles`.
--
-- La cause tient en un privilège manquant. Le rôle `authenticated` avait
-- INSERT, SELECT, DELETE, REFERENCES, TRIGGER et TRUNCATE sur `profiles` —
-- mais PAS UPDATE. Or :
--   · la création du profil (MainLayout) passe par un `upsert`, que PostgREST
--     traduit en `INSERT ... ON CONFLICT DO UPDATE` : sans le droit UPDATE,
--     Postgres refuse l'opération ENTIÈRE avec « 42501 permission denied » ;
--   · la fin de l'onboarding écrit `onboarding_completed = true` par un
--     `update()` : même refus.
-- La policy « users update own profile » existait bien — mais une policy ne
-- sert à rien sans le privilège : RLS restreint un droit, elle ne l'accorde
-- pas.
--
-- Et l'erreur était avalée par un `catch {}` « best-effort » côté client.
-- Rien n'apparaissait : ni dans l'interface, ni dans les journaux.
--
-- Reproduit avant correction : un compte neuf avec les mêmes métadonnées que
-- les deux utilisateurs réels → `42501 permission denied for table profiles`.

-- ── 1. LE PRIVILÈGE MANQUANT ──
-- La policy restreint déjà la mise à jour à SA PROPRE ligne
-- (`users update own profile`). Le grant ne rouvre donc rien d'autre : il
-- rend simplement applicable une règle qui ne pouvait pas s'exercer.
grant update on public.profiles to authenticated;

-- ── 2. LE PROFIL NE DÉPEND PLUS DU CLIENT ──
-- Même avec le privilège rétabli, faire créer le profil par le navigateur
-- laisse la porte ouverte à tout ce qui peut rater côté client : un onglet
-- fermé trop tôt, un réseau coupé, une erreur silencieuse. Le profil naît
-- donc avec le compte, côté serveur.
--
-- ── POURQUOI CETTE FONCTION NE PEUT PAS CASSER L'INSCRIPTION ──
-- Elle s'exécute DANS la transaction qui crée `auth.users`. Une exception y
-- ferait échouer l'inscription elle-même — c'est-à-dire transformer un
-- problème d'affichage en impossibilité de s'inscrire. Tout est donc capturé :
-- au pire on retombe sur le comportement d'avant (pas de profil), jamais sur
-- un compte impossible à créer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (user_id, pseudo, ville, country, age_confirmed)
  values (
    new.id,
    nullif(trim(coalesce(meta->>'pseudo', '')), ''),
    nullif(trim(coalesce(meta->>'ville', '')), ''),
    nullif(trim(coalesce(meta->>'country', '')), ''),
    -- Le formulaire d'inscription transporte la déclaration d'âge dans les
    -- métadonnées, le temps de la confirmation d'e-mail. Le déclencheur
    -- require_age_confirmed (0072) refuse l'insertion sans elle : un compte
    -- créé par un autre chemin (console, OAuth) n'aura donc pas de profil ici,
    -- et c'est le comportement voulu — on ne déclare pas l'âge à sa place.
    coalesce(meta->>'age_confirmed', '') = '1'
  )
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    raise warning '[handle_new_user] profil non créé pour % : %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

comment on function public.handle_new_user() is
  'Crée le profil REVS en même temps que le compte. Idempotent (on conflict do '
  'nothing) et à l''épreuve des exceptions : un échec ici ne doit jamais '
  'empêcher une inscription.';
