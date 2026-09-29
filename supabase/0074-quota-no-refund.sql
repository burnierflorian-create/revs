-- ════════════════════════════════════════════════════════════════════════
--  0074 — Supprimer un spot ne rend pas le crédit de publication
-- ════════════════════════════════════════════════════════════════════════
--
-- DÉCISION PRODUIT du 29/09/2026.
--
-- CONSTAT : `enforce_spot_daily_quota` comptait les LIGNES VIVANTES de
-- `spots` pour la journée. Depuis l'ajout de la suppression de spot
-- (commit 55b6cca), publier puis supprimer libérait donc un crédit, et le
-- plafond journalier devenait contournable à volonté.
--
-- CORRECTION : le plafond se lit désormais sur `spot_count_daily`, un
-- compteur cumulatif qu'aucun déclencheur ne décrémente — il n'existe aucun
-- déclencheur sur DELETE de `spots`. Ce que l'utilisateur a publié reste
-- compté, qu'il l'ait supprimé ensuite ou non.
--
-- ── POURQUOI `bump_spot_count` CHANGE AUSSI ──
-- Il écrivait `current_date`, c'est-à-dire la date UTC de la session, alors
-- que le plafond borne la journée sur Europe/Paris. Les deux divergeaient
-- donc chaque nuit entre minuit à Paris et minuit UTC — une à deux heures
-- selon l'heure d'été. Faire lire le plafond sur un compteur qui ne change pas
-- de jour au même instant aurait introduit un décalage silencieux : les deux
-- sont donc alignés sur la même borne.
--
-- EFFET DE BORD ACCEPTÉ, une seule fois : les lignes déjà présentes dans
-- `spot_count_daily` sont clés sur une date UTC. Pour les spots publiés cette
-- nuit-là dans la fenêtre de décalage, le compteur du jour peut repartir à
-- zéro une fois. L'effet est borné à quelques heures et ne concerne que des
-- comptes ayant publié dans cet intervalle précis.

-- ── 1 · Le compteur bascule sur la journée de Paris ──
create or replace function public.bump_spot_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.spot_count_daily (user_id, date, count)
  values (
    new.user_id,
    -- Même borne que enforce_spot_daily_quota() et que parisDayStart()
    -- côté serveur Node : les trois compteurs changent de jour ensemble.
    (now() at time zone 'Europe/Paris')::date,
    1
  )
  on conflict (user_id, date)
  do update set count = public.spot_count_daily.count + 1;
  return new;
end;
$$;

-- ── 2 · Le plafond lit le compteur, plus les lignes vivantes ──
create or replace function public.enforce_spot_daily_quota()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date;
  v_tier  text;
  v_limit integer;
  v_count integer;
begin
  -- `created_at` est FORCÉ à maintenant. Sans cela le plafond serait
  -- trivialement contournable : la politique RLS n'interdit pas à un client de
  -- fournir sa propre valeur, et il suffirait d'antidater les insertions pour
  -- sortir de la fenêtre de comptage.
  new.created_at := now();

  v_today := (now() at time zone 'Europe/Paris')::date;

  -- Tier dérivé de l'abonnement Stripe (migration 0015), jamais de
  -- profiles.tier qui n'est jamais écrit.
  begin
    v_tier := public.user_tier(new.user_id);
  exception when others then
    -- Tier illisible → on retombe sur le plafond gratuit. Restrictif, donc
    -- sans danger : un abonné verra une limite basse plutôt qu'un accès
    -- illimité accordé par erreur.
    v_tier := null;
  end;
  v_limit := public.spot_daily_limit(v_tier);

  -- Compteur CUMULATIF : il n'est jamais décrémenté, donc supprimer un spot
  -- ne rend pas le crédit. Le déclencheur qui l'incrémente est en AFTER
  -- INSERT, celui-ci en BEFORE : la ligne en cours n'est pas encore comptée,
  -- exactement comme avec l'ancien count(*).
  select coalesce(count, 0) into v_count
    from public.spot_count_daily
   where user_id = new.user_id and date = v_today;
  v_count := coalesce(v_count, 0);

  if v_count >= v_limit then
    -- Volontairement un RAISE WARNING et PAS une insertion dans
    -- api_abuse_attempts : le RAISE EXCEPTION qui suit annule la transaction,
    -- donc toute ligne écrite ici serait annulée avec elle.
    raise warning
      '[spot-quota] user=% tier=% publiés=% limite=% — insertion refusée',
      new.user_id, coalesce(v_tier, 'free'), v_count, v_limit;

    raise exception
      'Limite de % spots par jour atteinte pour le palier %. Réessaie demain.',
      v_limit, coalesce(v_tier, 'free')
      using errcode = 'check_violation',
            hint = 'spot_daily_quota_exceeded';
  end if;

  return new;
end;
$$;
