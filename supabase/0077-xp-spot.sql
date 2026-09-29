-- ════════════════════════════════════════════════════════════════════════
--  0077 — Nouveau barème du spot : la découverte remplace la fortune
-- ════════════════════════════════════════════════════════════════════════
--
-- ── LE PROBLÈME QU'ON CORRIGE ──
-- L'ancien barème donnait 10 à 250 XP selon la seule rareté, elle-même dérivée
-- du prix estimé. Facteur 25 entre une Clio et une Bugatti. Conséquence
-- mesurée à la simulation : deux joueurs également assidus progressaient à des
-- vitesses totalement différentes selon le parc automobile de leur ville. Un
-- habitant d'une ville moyenne était structurellement condamné.
--
-- ── LE NOUVEAU BARÈME ──
--   base                              +10   toujours
--   premier spot du jour (Paris)      +5    une fois par jour
--   modèle jamais spotté              +10   une fois par modèle
--   marque jamais spottée             +15   une fois par marque
--   catégorie jamais spottée          +5    une fois par catégorie
--   rareté, sur carte INÉDITE seulement :
--     standard 0 · premium 2 · performance 5 · exclusif 10 · supercar 15 · hypercar 20
--
-- ── DEUX DÉCISIONS À CONNAÎTRE ──
--
-- 1. LA RARETÉ NE PAIE QUE SUR UNE CARTE INÉDITE. La spec demandait que la
--    rareté devienne « un bonus de découverte et non le moteur de la
--    progression ». Un bonus qui se répète à chaque photo de la même voiture
--    n'est pas un bonus de découverte, c'est une rente. Il est donc versé
--    uniquement quand le spot crée une carte (marque + modèle + teinte
--    inédits). Mesuré en simulation : la rareté passe de moteur principal à
--    1–4 % de l'XP totale, et l'écart grande ville / petite ville tombe à 6 %.
--
-- 2. LA DÉCOTE DE RÉPÉTITION DISPARAÎT DE LA BASE. L'ancien système
--    multipliait le gain par 1 / 0,5 / 0,25 / 0,1 selon le rang du spot dans
--    la carte. Avec une base de 10 et un quota de 5 publications par jour, le
--    plafond de « spam » est de 50 XP/jour — moins qu'un seul défi difficile.
--    La complexité ne payait plus son prix. La barrière anti-farm des cartes
--    (12 h OU 500 m) est CONSERVÉE : elle gouverne la montée de niveau des
--    cartes, qui reste la progression de collection.
--
-- ── LA « SÉRIE » ──
-- La spec demandait un bonus de « nouvelle série ». Vérifié : REVS n'a aucune
-- notion de série — ni colonne, ni catalogue, ni donnée. Plutôt qu'inventer
-- une logique fragile, le bonus est branché sur `spots.category`, le seul
-- classement existant et fiable (supercar / hypercar / classic / youngtimer /
-- JDM / other). Six valeurs, donc un bonus d'amorçage qui sature vite : c'est
-- assumé, et c'est honnête.

create or replace function public.award_xp_spot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user       uuid := new.user_id;
  v_bkey       text := public.card_norm(new.brand);
  v_mkey       text := public.card_norm(new.model);
  v_ckey       text := public.color_key(new.color);
  v_cat        text := lower(btrim(coalesce(new.category, '')));
  v_paris_day  date := (new.created_at at time zone 'Europe/Paris')::date;

  v_card       public.card_progress%rowtype;
  v_has_card   boolean := false;
  v_new_card   boolean := false;
  v_valid_dup  boolean;
  v_new_count  int;
  v_new_level  int;

  v_rarity_xp  int;
  v_spot_xp    int := 0;   -- total crédité pour CE spot, pour card_progress
  v_days       int;
  v_milestone  int;
  v_reward     int;
begin
  -- ── 1 · Base, toujours ──
  insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
  values (v_user, 10, 'spot', 'spots', new.id)
  on conflict do nothing;
  v_spot_xp := v_spot_xp + 10;

  -- ── 2 · Premier spot de la journée parisienne ──
  -- Borné sur Europe/Paris, comme le quota de publication (migration 0074).
  -- L'ancien barème utilisait UTC : les deux divergeaient une à deux heures
  -- chaque nuit, et le « premier du jour » pouvait tomber sur le deuxième.
  if not exists (
    select 1 from public.spots s
     where s.user_id = v_user
       and s.id <> new.id
       and (s.created_at at time zone 'Europe/Paris')::date = v_paris_day
  ) then
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_user, 5, 'daily_first', 'spots', new.id)
    on conflict do nothing;
    v_spot_xp := v_spot_xp + 5;
  end if;

  -- ── 3 · Marque inédite ──
  -- Testée AVANT le modèle : une marque inédite implique un modèle inédit, et
  -- l'ordre des écritures détermine l'ordre d'affichage dans l'historique.
  if v_bkey <> '' and not exists (
    select 1 from public.spots s
     where s.user_id = v_user and s.id <> new.id
       and public.card_norm(s.brand) = v_bkey
  ) then
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_user, 15, 'new_brand', 'spots', new.id)
    on conflict do nothing;
    v_spot_xp := v_spot_xp + 15;
  end if;

  -- ── 4 · Modèle inédit ──
  if v_bkey <> '' and v_mkey <> '' and not exists (
    select 1 from public.spots s
     where s.user_id = v_user and s.id <> new.id
       and public.card_norm(s.brand) = v_bkey
       and public.card_norm(s.model) = v_mkey
  ) then
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_user, 10, 'new_model', 'spots', new.id)
    on conflict do nothing;
    v_spot_xp := v_spot_xp + 10;
  end if;

  -- ── 5 · Catégorie inédite ──
  if v_cat <> '' and not exists (
    select 1 from public.spots s
     where s.user_id = v_user and s.id <> new.id
       and lower(btrim(coalesce(s.category, ''))) = v_cat
  ) then
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_user, 5, 'new_category', 'spots', new.id)
    on conflict do nothing;
    v_spot_xp := v_spot_xp + 5;
  end if;

  -- ── 6 · Progression de carte, et bonus de rareté ──
  if v_bkey <> '' and v_mkey <> '' then
    select * into v_card from public.card_progress
      where user_id = v_user
        and brand_key = v_bkey and model_key = v_mkey and color_key = v_ckey;
    v_has_card := found;
    v_new_card := not v_has_card;

    -- Rareté : UNIQUEMENT sur une carte inédite. Voir la note en tête.
    if v_new_card then
      v_rarity_xp := case coalesce(new.rarity, 'standard')
        when 'hypercar'    then 20
        when 'supercar'    then 15
        when 'exclusif'    then 10
        when 'performance' then 5
        when 'premium'     then 2
        else                    0
      end;
      if v_rarity_xp > 0 then
        insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
        values (v_user, v_rarity_xp, 'rarity', 'spots', new.id)
        on conflict do nothing;
        v_spot_xp := v_spot_xp + v_rarity_xp;
      end if;
    end if;

    if v_new_card then
      insert into public.card_progress (
        user_id, brand_key, model_key, color_key, brand, model, color,
        valid_count, level, first_spot_at, last_spot_at, last_lat, last_lng,
        best_photo_url, cumulative_xp
      ) values (
        v_user, v_bkey, v_mkey, v_ckey, new.brand, new.model, new.color,
        1, 1, new.created_at, new.created_at, new.lat, new.lng,
        new.photo_url, v_spot_xp
      )
      on conflict (user_id, brand_key, model_key, color_key) do nothing;
    else
      -- Barrière anti-farm CONSERVÉE : un doublon ne compte que s'il est
      -- séparé de plus de 12 h OU de plus de 500 m du dernier spot valide.
      -- Elle gouverne la montée de niveau de la carte, pas l'XP.
      v_valid_dup :=
        (new.created_at - v_card.last_spot_at > interval '12 hours')
        or v_card.last_lat is null
        or v_card.last_lng is null
        or public.card_distance_m(
             v_card.last_lat, v_card.last_lng, new.lat, new.lng) > 500;

      if v_valid_dup then
        v_new_count := v_card.valid_count + 1;
        v_new_level := public.card_level_for(v_new_count);
        update public.card_progress set
          valid_count   = v_new_count,
          level         = v_new_level,
          last_spot_at  = new.created_at,
          last_lat      = new.lat,
          last_lng      = new.lng,
          cumulative_xp = v_card.cumulative_xp + v_spot_xp,
          title = case
                    when v_new_level >= 5 and v_card.title is null
                      then 'Maître de la ' || new.model
                    else v_card.title
                  end,
          updated_at    = now()
        where user_id = v_user
          and brand_key = v_bkey and model_key = v_mkey and color_key = v_ckey;
      else
        update public.card_progress set
          cumulative_xp = v_card.cumulative_xp + v_spot_xp,
          updated_at    = now()
        where user_id = v_user
          and brand_key = v_bkey and model_key = v_mkey and color_key = v_ckey;
      end if;
    end if;
  end if;

  -- ── 7 · Paliers de constance ──
  --
  -- Récompense le RETOUR, pas le volume : on compte les jours parisiens
  -- distincts où l'utilisateur a publié, jamais le nombre de spots. Trois
  -- paliers uniques, jamais répétables.
  --
  -- L'idempotence ne vient pas d'une table dédiée mais d'un source_id
  -- DÉTERMINISTE : md5(user:streak:N) donne toujours le même uuid pour un
  -- même palier et un même joueur, donc l'index unique du grand livre refuse
  -- naturellement le second crédit. Pas de table, pas d'état à maintenir.
  select count(distinct (created_at at time zone 'Europe/Paris')::date)
    into v_days
    from public.spots where user_id = v_user;

  foreach v_milestone in array array[7, 30, 100] loop
    if v_days >= v_milestone then
      v_reward := case v_milestone when 7 then 25 when 30 then 100 else 300 end;
      insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
      values (
        v_user, v_reward, 'streak_' || v_milestone, 'streak',
        md5(v_user::text || ':streak:' || v_milestone)::uuid
      )
      on conflict do nothing;
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.award_xp_spot() is
  'Barème XP du spot (refonte 29/09/2026) : base 10, premier du jour 5, marque inédite 15, modèle inédit 10, catégorie inédite 5, rareté 0-20 sur carte inédite uniquement. Paliers de constance 7/30/100 jours.';
