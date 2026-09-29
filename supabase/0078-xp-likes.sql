-- ════════════════════════════════════════════════════════════════════════
--  0078 — XP sociale : le like récompense la photo, sans pouvoir être armé
-- ════════════════════════════════════════════════════════════════════════
--
-- ── CE QUI NE MARCHAIT PAS ──
-- L'audit du 29/09 a relevé deux défauts opposés dans le même couple de
-- déclencheurs :
--
--   · Le retrait d'un like insérait TOUJOURS −1, même quand le like n'avait
--     rien rapporté (plafond journalier atteint). Un tiers pouvait donc faire
--     BAISSER l'XP d'un joueur : liker 20 spots (+10, plafond), tout retirer
--     (−20). Net −10 pour la victime, répétable chaque jour, sans limite.
--   · Rien n'interdisait l'auto-like. Vérifié en production : 7 des 11 likes
--     existants étaient des auto-likes, et constituaient la TOTALITÉ de l'XP
--     de like jamais gagnée.
--
-- ── CE QUI LES REMPLACE ──
-- Une table de comptabilité dédiée, `spot_like_xp`, avec une clé primaire
-- (spot, liker). Elle répond exactement aux questions que la spec posait :
-- quel spot, quel liker, quel propriétaire, quel gain, déjà attribué ou non.
--
-- Sa propriété décisive est la clé primaire : **un liker ne peut jamais
-- créditer deux fois le même spot, même après avoir retiré puis remis son
-- like.** Le cycle like/unlike/relike devient stérile — il ne rapporte rien à
-- la seconde tentative, et ne peut rien retirer de plus qu'il n'a donné.
--
-- ── PLAFONDS ──
--   15 XP par SPOT   — demandé par la spec. Une belle photo plafonne à +15.
--   30 XP par JOUR   — AJOUTÉ après simulation. Sans lui, un profil très
--                      suivi tirait 36 % de son XP des seuls likes (5 spots ×
--                      15). Ramené à 23 %, ce qui laisse la mécanique
--                      significative sans qu'elle domine l'économie.

-- ─────────────────── Table de comptabilité ───────────────────

create table if not exists public.spot_like_xp (
  spot_id    uuid not null references public.spots(id)      on delete cascade,
  liker_id   uuid not null references auth.users(id)        on delete cascade,
  owner_id   uuid not null references auth.users(id)        on delete cascade,
  -- 1 = ce like a réellement crédité de l'XP · 0 = plafond atteint au moment
  -- du like, donc rien à rendre s'il est retiré.
  awarded    integer not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (spot_id, liker_id)
);

comment on table public.spot_like_xp is
  'Comptabilité des gains XP de like. PK (spot, liker) : un liker ne crédite jamais deux fois le même spot, même après unlike/relike.';

alter table public.spot_like_xp enable row level security;
-- Aucune politique : table de comptabilité interne, accessible uniquement aux
-- fonctions SECURITY DEFINER et à service_role. Même parti que `ai_usage`.

create index if not exists spot_like_xp_owner_idx on public.spot_like_xp (owner_id);

-- ─────────────────── Verrou anti auto-like ───────────────────
--
-- En BEFORE INSERT et non dans le déclencheur d'XP : liker son propre spot ne
-- doit pas seulement être non rémunéré, cela doit être impossible. Une
-- politique RLS ne peut pas l'exprimer (elle ne voit pas la table `spots`).

create or replace function public.block_self_like()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.spots where id = new.spot_id;
  if v_owner is not null and v_owner = new.user_id then
    raise exception 'Impossible de liker son propre spot.'
      using hint = 'self_like_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_self_like on public.spot_likes;
create trigger trg_block_self_like
  before insert on public.spot_likes
  for each row execute function public.block_self_like();

-- ─────────────────── Attribution ───────────────────

create or replace function public.award_xp_like()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner     uuid;
  v_spot_xp   int;
  v_day_xp    int;
  v_grant     int := 0;
  v_inserted  int := 0;
begin
  select user_id into v_owner from public.spots where id = new.spot_id;
  if v_owner is null or v_owner = new.user_id then
    return new;   -- spot disparu, ou auto-like (déjà bloqué en amont)
  end if;

  -- Plafond par SPOT : 15 gains actifs au maximum.
  select count(*) into v_spot_xp
    from public.spot_like_xp
   where spot_id = new.spot_id and awarded = 1 and revoked_at is null;

  -- Plafond par JOUR pour le propriétaire, borné sur Europe/Paris comme le
  -- reste de l'économie. Seuls les gains POSITIFS comptent : un retrait ne
  -- doit pas rouvrir du plafond, sinon il redeviendrait une arme.
  select coalesce(sum(amount), 0) into v_day_xp
    from public.xp_transactions
   where user_id = v_owner
     and reason = 'like'
     and amount > 0
     and (created_at at time zone 'Europe/Paris')::date
         = (now() at time zone 'Europe/Paris')::date;

  if v_spot_xp < 15 and v_day_xp < 30 then
    v_grant := 1;
  end if;

  -- La clé primaire fait tout le travail : si ce liker a DÉJÀ été comptabilisé
  -- sur ce spot — même s'il avait retiré son like depuis — l'insertion ne
  -- passe pas et aucune XP n'est versée.
  insert into public.spot_like_xp (spot_id, liker_id, owner_id, awarded)
  values (new.spot_id, new.user_id, v_owner, v_grant)
  on conflict (spot_id, liker_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 and v_grant = 1 then
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_owner, 1, 'like', 'spot_likes', new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- ─────────────────── Retrait ───────────────────

create or replace function public.revoke_xp_like()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_row   public.spot_like_xp%rowtype;
begin
  select * into v_row from public.spot_like_xp
    where spot_id = old.spot_id and liker_id = old.user_id;

  -- Rien n'avait été crédité (plafond atteint, auto-like, spot supprimé) :
  -- il n'y a rien à retirer. C'est LE correctif du drain d'XP.
  if not found or v_row.awarded <> 1 or v_row.revoked_at is not null then
    return old;
  end if;

  v_owner := v_row.owner_id;

  update public.spot_like_xp
     set revoked_at = now()
   where spot_id = old.spot_id and liker_id = old.user_id;

  insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
  values (v_owner, -1, 'like_removed', 'spot_likes', old.id)
  on conflict do nothing;

  return old;
end;
$$;

comment on function public.revoke_xp_like() is
  'Ne retire de l''XP QUE si le like en avait réellement produit. Empêche le drain d''XP d''un tiers par cycles like/unlike.';

-- ─────────────────── Reprise de l'historique ───────────────────
--
-- Les 11 likes existants n'ont pas de ligne de comptabilité. Sans reprise,
-- retirer l'un de ces likes ne rendrait rien — ce qui est le bon comportement
-- par défaut (on ne retire que ce qu'on a donné), mais l'historique montre
-- 7 XP réellement crédités, tous issus d'auto-likes.
--
-- On enregistre donc les likes existants comme « comptabilisés, non
-- rémunérés » (awarded = 0) : ils ne peuvent plus rien rapporter, et leur
-- retrait ne retirera rien. Les 7 XP déjà acquis restent acquis — on ne
-- remet personne à zéro (règle §32 de la refonte).

insert into public.spot_like_xp (spot_id, liker_id, owner_id, awarded, created_at)
select l.spot_id, l.user_id, s.user_id, 0, l.created_at
  from public.spot_likes l
  join public.spots s on s.id = l.spot_id
on conflict (spot_id, liker_id) do nothing;
