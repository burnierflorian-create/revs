-- ════════════════════════════════════════════════════════════════════════
--  0076 — Fondations de la nouvelle économie XP
-- ════════════════════════════════════════════════════════════════════════
--
-- Première des cinq migrations de la refonte XP (29/09/2026). Elle ne change
-- AUCUN barème : elle pose ce dont tout le reste dépend.
--
--   1. Traçabilité du grand livre  → source_table / source_id + idempotence
--   2. Total matérialisé            → profiles.xp_total, maintenu par trigger
--   3. Courbe de niveaux            → 100 niveaux, 100 × (N−1)^1.5
--   4. Prestige                     → profiles.prestige / prestige_xp_base
--   5. Titres                       → une seule échelle, dérivée du niveau
--
-- ── CE QUI NE CHANGE PAS ──
-- `xp_transactions` reste APPEND-ONLY. Aucune ligne existante n'est modifiée
-- ni supprimée. Aucun utilisateur n'est remis à zéro. Les 2 641 XP déjà
-- gagnés sont conservés tels quels ; seule leur traduction en NIVEAU change.

-- ─────────────────── 1 · Traçabilité du grand livre ───────────────────
--
-- L'audit du 29/09 a montré que le journal ne porte aucune référence à
-- l'action : impossible de savoir QUEL spot a produit QUEL gain, donc
-- impossible de recalculer, d'auditer, ou d'annuler proprement. Deux colonnes
-- corrigent cela.
--
-- L'index unique est ce qui rend le système idempotent : un même (utilisateur,
-- raison, source) ne peut plus être crédité deux fois, quel que soit le chemin
-- d'appel. Partiel, parce que les lignes historiques n'ont pas de source et
-- doivent rester telles quelles.

alter table public.xp_transactions
  add column if not exists source_table text,
  add column if not exists source_id    uuid;

comment on column public.xp_transactions.source_table is
  'Table à l''origine du gain : spots, spot_likes, challenges, events, streak, collection, race, referral.';
comment on column public.xp_transactions.source_id is
  'Identifiant de la ligne source. Avec source_table et reason, forme la clé d''idempotence.';

create unique index if not exists xp_tx_source_unique
  on public.xp_transactions (user_id, reason, source_table, source_id)
  where source_id is not null;

-- Index de lecture : le profil affiche l'historique par date décroissante.
create index if not exists xp_tx_user_created_idx
  on public.xp_transactions (user_id, created_at desc);

-- ─────────────────── 2 · Total matérialisé ───────────────────
--
-- Jusqu'ici, CHAQUE affichage d'XP refaisait un `sum(amount)` complet, et
-- chaque classement une agrégation sur toute la table. À 8 comptes c'est
-- gratuit ; à 10 000 c'est le premier point de rupture.
--
-- `profiles.xp_total` est un INDEX, pas une source de vérité : le grand livre
-- reste l'autorité, et `revs_reconcile_xp()` plus bas permet de le recalculer
-- à tout moment. Le trigger est en AFTER INSERT seulement — le journal étant
-- append-only, il n'y a ni UPDATE ni DELETE à intercepter.

alter table public.profiles
  add column if not exists xp_total integer not null default 0;

comment on column public.profiles.xp_total is
  'Somme matérialisée de xp_transactions.amount. Maintenue par trigger ; recalculable par revs_reconcile_xp().';

create or replace function public.bump_xp_total()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.profiles
     set xp_total = xp_total + new.amount
   where user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists trg_bump_xp_total on public.xp_transactions;
create trigger trg_bump_xp_total
  after insert on public.xp_transactions
  for each row execute function public.bump_xp_total();

/** Recalcule xp_total depuis le grand livre. À lancer après toute opération
 *  de maintenance sur xp_transactions. Renvoie le nombre de profils corrigés. */
create or replace function public.revs_reconcile_xp()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_fixed int;
begin
  with truth as (
    select p.user_id, coalesce(sum(x.amount), 0)::int as total
      from public.profiles p
      left join public.xp_transactions x on x.user_id = p.user_id
     group by p.user_id
  )
  update public.profiles p
     set xp_total = t.total
    from truth t
   where t.user_id = p.user_id and p.xp_total is distinct from t.total;
  get diagnostics v_fixed = row_count;
  return v_fixed;
end;
$$;

-- Amorçage : aligne la colonne sur l'historique déjà en base.
select public.revs_reconcile_xp();

-- ─────────────────── 3 · Courbe de niveaux ───────────────────
--
-- 100 niveaux, XP cumulée = round(100 × (N−1)^1.5).
--   niveau 2 → 100 · niveau 10 → 2 700 · niveau 50 → 34 300 · niveau 100 → 98 504
--
-- Le choix d'un exposant 1,5 plutôt qu'un doublement par palier : le
-- doublement rend les derniers niveaux inatteignables (l'ancien système
-- demandait 25 000 XP pour le seul dernier palier). Une puissance 1,5 fait
-- croître l'écart entre niveaux de façon régulière — 100 XP entre les niveaux
-- 1 et 2, 1 489 entre les niveaux 99 et 100 — donc un niveau reste toujours
-- un objectif atteignable, même à la fin.
--
-- IMMUTABLE : le planificateur peut mettre ces appels en cache, et ils sont
-- utilisables dans un index si le besoin s'en présente.

create or replace function public.revs_xp_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  select case
    when p_level <= 1 then 0
    else round(100 * power(least(p_level, 100) - 1, 1.5))::int
  end;
$$;

create or replace function public.revs_level_for_xp(p_xp integer)
returns integer
language sql
immutable
as $$
  -- Inversion directe de la courbe : N = 1 + (xp/100)^(1/1.5), bornée à [1,100].
  -- floor() garantit qu'on ne dépasse jamais le seuil réellement franchi.
  select greatest(1, least(100,
    1 + floor(power(greatest(p_xp, 0)::numeric / 100.0, 1.0 / 1.5))::int
  ));
$$;

-- ─────────────────── 4 · Prestige ───────────────────
--
-- Le niveau 100 ne doit pas être la fin. Le prestige rouvre la courbe sans
-- jamais toucher au grand livre : on mémorise l'XP au moment du passage
-- (`prestige_xp_base`) et le niveau se calcule sur ce qui a été gagné DEPUIS.
--
-- Conséquences voulues : l'XP totale reste monotone et comparable entre
-- joueurs (les classements ne changent pas de sens), rien n'est remis à zéro
-- — ni spots, ni cartes, ni collection, ni badges — et chaque prestige
-- redemande exactement le même effort que le premier centième niveau.

alter table public.profiles
  add column if not exists prestige integer not null default 0,
  add column if not exists prestige_xp_base integer not null default 0;

comment on column public.profiles.prestige is
  'Nombre de prestiges validés. 0 = jamais prestigé.';
comment on column public.profiles.prestige_xp_base is
  'XP totale au moment du dernier prestige. Le niveau se calcule sur (xp_total − cette valeur).';

-- ─────────────────── 5 · Titres — une seule échelle ───────────────────
--
-- L'audit a relevé TROIS systèmes de titres qui se chevauchaient : l'échelle
-- XP (dupliquée dans deux fichiers client), le titre manuel de `profiles.title`
-- qui écrasait tout, et un titre de carte sans rapport.
--
-- Ils sont désormais séparés par nature :
--   · TITRE DE NIVEAU (ici)      — dérivé, automatique, change en jouant
--   · STATUT DE COMPTE (profiles.title) — « Fondateur », attribué à la main
-- Les deux s'affichent ensemble. Le statut n'écrase plus la progression.

create or replace function public.revs_title_for_level(p_level integer)
returns text
language sql
immutable
as $$
  select case
    when p_level >= 100 then 'REVS OG'
    when p_level >= 90  then 'Icon'
    when p_level >= 75  then 'Legend'
    when p_level >= 60  then 'Elite'
    when p_level >= 50  then 'Master'
    when p_level >= 40  then 'Pro Spotter'
    when p_level >= 30  then 'Collector'
    when p_level >= 20  then 'Hunter'
    when p_level >= 10  then 'Explorer'
    when p_level >= 5   then 'Spotter'
    else                     'Rookie'
  end;
$$;

-- ─────────────────── 6 · Le point d'entrée du client ───────────────────
--
-- UNE seule requête donne tout ce qu'un écran de progression affiche. Le
-- client ne recalcule plus rien : il ne peut donc plus diverger du serveur,
-- ce qui était l'un des défauts relevés par l'audit.

create or replace function public.my_progress()
returns table (
  xp_total       integer,
  prestige       integer,
  level          integer,
  title          text,
  account_title  text,
  level_xp       integer,   -- XP acquise dans le niveau courant
  level_span     integer,   -- XP nécessaire pour franchir le niveau courant
  pct            integer,   -- progression dans le niveau, 0-100
  next_level_at  integer,   -- XP cumulée (hors prestige) du niveau suivant
  is_max         boolean    -- niveau 100 atteint → prestige disponible
)
language sql
security definer
set search_path to 'public'
as $$
  with me as (
    select coalesce(p.xp_total, 0) as xp,
           coalesce(p.prestige, 0) as prestige,
           coalesce(p.prestige_xp_base, 0) as base,
           p.title
      from public.profiles p
     where p.user_id = auth.uid()
  ),
  lvl as (
    select me.*,
           greatest(0, me.xp - me.base) as cycle_xp,
           public.revs_level_for_xp(greatest(0, me.xp - me.base)) as lv
      from me
  )
  select
    lvl.xp,
    lvl.prestige,
    lvl.lv,
    public.revs_title_for_level(lvl.lv),
    nullif(btrim(coalesce(lvl.title, '')), ''),
    (lvl.cycle_xp - public.revs_xp_for_level(lvl.lv))::int,
    greatest(1, public.revs_xp_for_level(lvl.lv + 1) - public.revs_xp_for_level(lvl.lv))::int,
    case when lvl.lv >= 100 then 100 else least(100, greatest(0, floor(
      (lvl.cycle_xp - public.revs_xp_for_level(lvl.lv))::numeric
      / greatest(1, public.revs_xp_for_level(lvl.lv + 1) - public.revs_xp_for_level(lvl.lv))
      * 100)::int)) end,
    public.revs_xp_for_level(lvl.lv + 1),
    lvl.lv >= 100
  from lvl;
$$;

-- ─────────────────── 7 · Passage de prestige ───────────────────
--
-- Volontairement RÉCLAMÉ et non automatique : franchir un prestige est un
-- geste, pas un effet de bord. Le serveur revérifie le niveau — le client ne
-- peut pas le demander en avance.

create or replace function public.claim_prestige()
returns table (ok boolean, prestige integer, level integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_xp   int;
  v_base int;
  v_pres int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select xp_total, prestige_xp_base, prestige
    into v_xp, v_base, v_pres
    from public.profiles where user_id = v_user for update;

  if not found then
    return query select false, 0, 1; return;
  end if;

  if public.revs_level_for_xp(greatest(0, v_xp - v_base)) < 100 then
    return query select false, v_pres, public.revs_level_for_xp(greatest(0, v_xp - v_base));
    return;
  end if;

  -- La nouvelle base est le seuil du niveau 100, PAS l'XP totale : l'excédent
  -- déjà gagné au-delà du niveau 100 est reporté sur le cycle suivant plutôt
  -- que perdu.
  update public.profiles
     set prestige = prestige + 1,
         prestige_xp_base = v_base + public.revs_xp_for_level(100)
   where user_id = v_user;

  select prestige, prestige_xp_base into v_pres, v_base
    from public.profiles where user_id = v_user;

  return query select true, v_pres, public.revs_level_for_xp(greatest(0, v_xp - v_base));
end;
$$;
