-- ════════════════════════════════════════════════════════════════════════
--  0079 — Défis gradués et XP d'événement
-- ════════════════════════════════════════════════════════════════════════
--
-- ── CE QUI NE MARCHAIT PAS ──
-- Les 14 défis donnaient TOUS exactement 30 XP. « Youngtimer collector »
-- (1 spot) valait autant que « Marathon du week-end » (10 spots). Pire : la
-- mise à l'échelle par difficulté augmentait la CIBLE sans toucher à la
-- récompense — monter en difficulté rendait donc le jeu strictement moins
-- rentable. Et l'assignation hebdomadaire ignorait le drapeau `active`,
-- distribuant les 11 défis retirés comme les autres.

-- ─────────────────── Difficulté ───────────────────

alter table public.challenges
  add column if not exists difficulty text not null default 'easy';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.challenges'::regclass
       and conname = 'challenges_difficulty_check'
  ) then
    alter table public.challenges
      add constraint challenges_difficulty_check
      check (difficulty in ('easy', 'medium', 'hard', 'event'));
  end if;
end $$;

comment on column public.challenges.difficulty is
  'easy 25 XP · medium 50 · hard 100 · event 150-300. Détermine xp_reward, fixé côté serveur.';

-- Reclassement du catalogue existant d'après l'effort réellement demandé.
-- Le seuil n'est pas arbitraire : un défi de marque ou de catégorie à cible 1
-- se boucle en une sortie, une cible ≥ 5 demande une semaine de régularité.
update public.challenges
   set difficulty = case
     when target_value >= 8 then 'hard'
     when target_value >= 3 then 'medium'
     else 'easy'
   end;

update public.challenges
   set xp_reward = case difficulty
     when 'hard'   then 100
     when 'medium' then 50
     when 'event'  then 200
     else               25
   end;

/** Récompense officielle d'un défi. Point de vérité unique : ni le client ni
 *  la colonne ne peuvent inventer un montant hors barème. */
create or replace function public.revs_challenge_xp(p_difficulty text, p_reward integer)
returns integer
language sql
immutable
as $$
  select case p_difficulty
    when 'hard'   then 100
    when 'medium' then 50
    when 'easy'   then 25
    -- Les défis événementiels portent leur propre montant, borné à [150, 300].
    when 'event'  then least(300, greatest(150, coalesce(p_reward, 200)))
    else               25
  end;
$$;

-- ─────────────────── Assignation : ne tirer que des défis actifs ───────────────────

create or replace function public.assign_weekly_challenges_for(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week  date := date_trunc('week', now())::date;
  v_level int;
  v_pool  int;
begin
  if p_user is null then return; end if;

  perform public.roll_user_difficulty_for(p_user);

  if exists (
    select 1 from public.user_weekly_challenges
    where user_id = p_user and week_start = v_week
  ) then
    return;
  end if;

  select level into v_level from public.user_challenge_difficulty where user_id = p_user;
  v_level := coalesce(v_level, 0);

  -- `active` est désormais RESPECTÉ. Repli si le catalogue actif est trop
  -- maigre : mieux vaut trois défis dont certains retirés que zéro défi.
  select count(*) into v_pool from public.challenges where active;

  insert into public.user_weekly_challenges
    (user_id, week_start, challenge_id, slot, scaled_target)
  select p_user, v_week, c.id,
         (row_number() over () - 1)::int as slot,
         public.revs_scaled_target(c.target_value, v_level)
  from (
    select id, target_value from public.challenges
     where active or v_pool < 3
     order by random() limit 3
  ) c;
end;
$$;

-- ─────────────────── Réclamation automatique, au barème ───────────────────

create or replace function public.auto_claim_weekly_challenges_on_spot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := new.user_id;
  v_week date := date_trunc('week', new.created_at)::date;
  c      record;
  v_progress int;
  v_xp   int;
begin
  perform public.assign_weekly_challenges_for(v_user);

  for c in
    select uwc.challenge_id, uwc.scaled_target,
           ch.type, ch.target_brand, ch.target_category,
           ch.xp_reward, ch.difficulty, ch.title
    from public.user_weekly_challenges uwc
    join public.challenges ch on ch.id = uwc.challenge_id
    where uwc.user_id = v_user
      and uwc.week_start = v_week
      and uwc.claimed = false
  loop
    -- Progression RECOMPTÉE côté serveur depuis `spots` — jamais reçue du
    -- client. C'était déjà le cas et c'est conservé tel quel.
    select count(*) into v_progress
    from public.spots s
    where s.user_id = v_user
      and s.created_at >= v_week::timestamptz
      and s.created_at <  (v_week + 7)::timestamptz
      and (
        (c.type = 'spot_count')
        or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
        or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
      );

    if v_progress >= c.scaled_target then
      v_xp := public.revs_challenge_xp(c.difficulty, c.xp_reward);
      with claim as (
        update public.user_weekly_challenges
        set claimed = true, completed_at = now()
        where user_id = v_user and week_start = v_week
          and challenge_id = c.challenge_id and claimed = false
        returning challenge_id
      )
      insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
      select v_user, v_xp, 'challenge:' || c.title, 'challenges', claim.challenge_id
      from claim
      on conflict do nothing;
    end if;
  end loop;

  return new;
end;
$$;

-- Les deux réclamations manuelles (jamais appelées par le client aujourd'hui,
-- mais vivantes en base) suivent le même barème, pour qu'aucun chemin ne
-- puisse verser un montant différent.

create or replace function public.claim_weekly_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user      uuid := auth.uid();
  v_week      date := date_trunc('week', now())::date;
  v_row       public.user_weekly_challenges%rowtype;
  v_challenge public.challenges%rowtype;
  v_progress  int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_row from public.user_weekly_challenges
    where user_id = v_user and week_start = v_week and challenge_id = p_challenge_id;
  if not found or v_row.claimed then return false; end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then return false; end if;

  v_progress := public.revs_challenge_progress(
    v_user, v_challenge, v_week::timestamptz, (v_week + 7)::timestamptz
  );
  if v_progress < v_row.scaled_target then return false; end if;

  update public.user_weekly_challenges
    set claimed = true, completed_at = now()
    where user_id = v_user and week_start = v_week and challenge_id = p_challenge_id;

  insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_user,
            public.revs_challenge_xp(v_challenge.difficulty, v_challenge.xp_reward),
            'challenge:' || v_challenge.title, 'challenges', p_challenge_id)
  on conflict do nothing;

  return true;
end;
$$;

-- ─────────────────── Événements ───────────────────
--
-- ── POURQUOI PAS 150 À 300 XP POUR CRÉER UN ÉVÉNEMENT ──
-- La spec prévoit des récompenses événementielles de 150 à 300 XP. Mais dans
-- REVS, créer un événement est une action LIBRE : `events` accepte les
-- insertions des utilisateurs. Verser 150 XP à la création serait exactement
-- le genre de faille que cette refonte ferme ailleurs — 5 événements bidon et
-- le niveau 10 est acquis.
--
-- Les deux besoins sont donc séparés :
--   · CRÉER un événement → +50 XP, plafonné à 3 événements récompensés par
--     mois parisien. C'est une contribution, pas un jackpot.
--   · Les récompenses de 150 à 300 XP passent par la difficulté `event` des
--     défis, écrite en base par un administrateur et jamais par un client.
--     L'architecture est en place ci-dessus ; aucun défi événementiel n'est
--     créé par cette migration.

create or replace function public.award_xp_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_this_month int;
begin
  select count(*) into v_this_month
    from public.xp_transactions
   where user_id = new.organizer_id
     and reason = 'event'
     and amount > 0
     and (created_at at time zone 'Europe/Paris')
         >= date_trunc('month', now() at time zone 'Europe/Paris');

  if v_this_month < 3 then
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (new.organizer_id, 50, 'event', 'events', new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

comment on function public.award_xp_event() is
  'Création d''événement : +50 XP, maximum 3 événements récompensés par mois parisien. Les récompenses 150-300 passent par les défis de difficulté ''event''.';
