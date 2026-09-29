-- ════════════════════════════════════════════════════════════════════════
--  0084 — Parrainage : distinguer le filleul INSCRIT du filleul ACTIF
-- ════════════════════════════════════════════════════════════════════════
--
-- Le système de parrainage existe déjà en entier : `profiles.invite_code`
-- (posé par déclencheur à la création), la table `referrals`, la fonction
-- `claim_referral()` qui bloque l'auto-parrainage et n'accepte qu'un parrain
-- par filleul, et `my_referral_stats()`. Rien de tout cela n'est refait.
--
-- CE QUI MANQUAIT : `referred_count` compte les comptes CRÉÉS. Or créer un
-- compte ne coûte rien — c'est précisément ce que la spec veut éviter de
-- récompenser (§10, §43). On ajoute donc un second compteur, `active_count`,
-- qui n'inclut un filleul que s'il a réellement publié au moins un spot.
--
-- Les deux sont exposés côte à côte plutôt que de remplacer l'un par l'autre :
-- l'interface peut ainsi montrer « 3 inscrits · 2 actifs » et rendre visible
-- la différence, au lieu de la masquer.
--
-- AUCUNE RÉCOMPENSE N'EST CRÉÉE ICI. La spec demande de ne pas inventer un
-- barème sans base fiable ; seule la mesure est posée.

-- La signature change (ajout d'`active_count`) : Postgres refuse un
-- CREATE OR REPLACE qui modifie le type de retour, il faut donc supprimer
-- d'abord. Aucun appelant n'est cassé — le client lit les colonnes par nom.
drop function if exists public.my_referral_stats();

create function public.my_referral_stats()
returns table (
  invite_code       text,
  referred_count    integer,
  active_count      integer,
  xp_from_referrals integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;
  return query
    select
      (select p.invite_code from public.profiles p where p.user_id = v_user),
      (select count(*)::int
         from public.referrals r
        where r.referrer_id = v_user),
      -- Filleul ACTIF = a publié au moins un spot. Le critère est
      -- volontairement simple et vérifiable côté serveur ; il pourra se
      -- durcir (ancienneté, régularité) sans changer la signature.
      (select count(*)::int
         from public.referrals r
        where r.referrer_id = v_user
          and exists (select 1 from public.spots s where s.user_id = r.referred_id)),
      coalesce((
        select sum(x.amount)::int
          from public.xp_transactions x
         where x.user_id = v_user and x.reason like 'referral:%'
      ), 0);
end;
$$;

comment on function public.my_referral_stats() is
  'Statistiques de parrainage du joueur. `active_count` ne compte que les filleuls ayant publié au moins un spot — un compte créé ne suffit pas.';

-- ─────────────────── Rang au classement, sans tout télécharger ───────────────────
--
-- Le profil calculait le rang en récupérant `user_id` de TOUS les spots de la
-- base, puis en les comptant côté client. À 30 spots c'est indolore ; à
-- 100 000 c'est un tirage complet de table vers le navigateur.
--
-- Avec `profiles.xp_total` (migration 0076), le rang se calcule en une
-- comparaison indexée. Il devient aussi COHÉRENT avec `/classement`, vers
-- lequel la statistique renvoie : les deux trient désormais sur la même
-- grandeur, l'XP, là où le profil triait sur le nombre de spots.

create or replace function public.my_rank()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  select case
    when (select coalesce(xp_total, 0) from public.profiles where user_id = auth.uid()) <= 0
      then null
    else (
      select count(*)::int + 1
        from public.profiles p
       where p.xp_total > (
             select coalesce(xp_total, 0) from public.profiles where user_id = auth.uid()
           )
         and coalesce(p.is_public, true)
    )
  end;
$$;

comment on function public.my_rank() is
  'Rang du joueur au classement global, par XP. NULL tant qu''il n''a aucune XP.';
