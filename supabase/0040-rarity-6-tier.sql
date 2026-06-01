-- ─────────────────────── Rarity 6-tier upgrade ───────────────────────
-- Migrates the rarity enum from the 4-value set
--   ('commun', 'rare', 'ultra_rare', 'unique')
-- to the new 6-value scale:
--   ('standard','premium','performance','exclusif','supercar','hypercar')
--
-- Conservative mapping (the new tiers `performance` and `exclusif`
-- start empty; the AI will produce them for new spots):
--   commun     → standard
--   rare       → premium
--   ultra_rare → supercar
--   unique     → hypercar
--
-- Touches:
--   1. The spots.rarity CHECK constraint
--   2. The spots.rarity column default
--   3. award_xp_spot() — flat per-rarity XP table (replaces 0039's
--      10/25/60/150 with the 6-tier 10/25/50/90/150/250 ladder)
--   4. race_card_horsepower() — 6-tier fallback HP table
--   5. start_race() — 6-tier weighted opponent rarity roll and 6-tier
--      synthetic-opponent HP table
--
-- Everything else (challenges, like XP, daily/streak bonuses, stake
-- roll) is preserved verbatim.

begin;

-- ──────────────── 1. Schema migration ────────────────

alter table public.spots
  drop constraint if exists spots_rarity_check;

-- Rename existing data into the new vocabulary. Done before the new
-- CHECK so the constraint is satisfied at attach time.
update public.spots set rarity = 'standard' where rarity = 'commun';
update public.spots set rarity = 'premium'  where rarity = 'rare';
update public.spots set rarity = 'supercar' where rarity = 'ultra_rare';
update public.spots set rarity = 'hypercar' where rarity = 'unique';

alter table public.spots
  add constraint spots_rarity_check
  check (rarity in (
    'standard',
    'premium',
    'performance',
    'exclusif',
    'supercar',
    'hypercar'
  ));

alter table public.spots
  alter column rarity set default 'standard';

-- ──────────────── 2. XP trigger rewrite ────────────────
-- Replaces the function body installed by 0039. Daily-first +1×10
-- and streak +1×5 bonuses preserved verbatim.

create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  r              text := coalesce(new.rarity, 'standard');
  base_xp        int;
  v_today_count  int;
  v_yesterday    int;
  day_start      timestamptz := date_trunc('day', new.created_at);
begin
  base_xp := case r
    when 'hypercar'    then 250
    when 'supercar'    then 150
    when 'exclusif'    then 90
    when 'performance' then 50
    when 'premium'     then 25
    else                    10  -- standard
  end;

  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, base_xp, 'spot');

  select count(*) into v_today_count
    from public.spots
   where user_id   = new.user_id
     and created_at >= day_start
     and created_at <= new.created_at;

  if v_today_count = 1 then
    insert into public.xp_transactions (user_id, amount, reason)
    values (new.user_id, 10, 'daily_first');

    select count(*) into v_yesterday
      from public.spots
     where user_id   = new.user_id
       and created_at >= day_start - interval '1 day'
       and created_at <  day_start;

    if v_yesterday > 0 then
      insert into public.xp_transactions (user_id, amount, reason)
      values (new.user_id, 5, 'streak');
    end if;
  end if;

  return new;
end; $$;

-- ──────────────── 3. Race horsepower fallback ────────────────
-- Replaces the case branch installed by 0037 with the 6-tier ladder.
-- Spec lookup logic (card_specs.horsepower regex extraction) is
-- preserved verbatim — only the fallback default changes.

create or replace function public.race_card_horsepower(p_card_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot  public.spots%rowtype;
  v_specs jsonb;
  v_hp    text;
  v_n     int;
begin
  select * into v_spot from public.spots where id = p_card_id;
  if not found then return 200; end if;

  select specs into v_specs from public.card_specs
    where brand = v_spot.brand and model = v_spot.model
    order by updated_at desc nulls last
    limit 1;

  if v_specs is not null then
    v_hp := coalesce(v_specs->>'horsepower', '');
    v_n := nullif(regexp_replace(v_hp, '[^0-9]', '', 'g'), '')::integer;
    if v_n is not null and v_n between 50 and 2500 then
      return v_n;
    end if;
  end if;

  return case coalesce(v_spot.rarity, 'standard')
    when 'hypercar'    then 800
    when 'supercar'    then 600
    when 'exclusif'    then 500
    when 'performance' then 400
    when 'premium'     then 300
    else                    200  -- standard
  end;
end;
$$;

grant execute on function public.race_card_horsepower(uuid) to authenticated;

-- ──────────────── 4. start_race rewrite ────────────────
-- Replaces the function body installed by 0038. Stake roll logic +
-- cascade-1/2/3 opponent picker preserved verbatim; only the rarity
-- weighting and the synthetic-opponent HP table change.

create or replace function public.start_race(p_card_id uuid)
returns table (
  race_id        uuid,
  player_hp      integer,
  opponent       jsonb,
  stake_type     text,
  stake_value    jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_spot public.spots%rowtype;
  v_hp   integer;
  v_op_rarity text;
  v_op_spot   public.spots%rowtype;
  v_op_hp     integer;
  v_op        jsonb;
  v_op_spot_id uuid;
  v_seed numeric;
  v_seed2 numeric;
  v_stake_type  text;
  v_stake_value jsonb;
  v_race_id uuid;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_spot from public.spots
    where id = p_card_id and user_id = v_user;
  if not found then raise exception 'card not owned'; end if;

  v_hp := public.race_card_horsepower(p_card_id);

  -- 6-tier rarity bucket — biased toward common tiers so a Standard
  -- card player still draws a competitive opponent most of the time.
  -- Cumulative: .45 / .70 / .85 / .93 / .98 / 1.00
  v_seed := random();
  if    v_seed < 0.45 then v_op_rarity := 'standard';
  elsif v_seed < 0.70 then v_op_rarity := 'premium';
  elsif v_seed < 0.85 then v_op_rarity := 'performance';
  elsif v_seed < 0.93 then v_op_rarity := 'exclusif';
  elsif v_seed < 0.98 then v_op_rarity := 'supercar';
  else                     v_op_rarity := 'hypercar';
  end if;

  -- Cascade 1: foreign-user spot of target rarity with a photo
  select * into v_op_spot from public.spots
    where rarity = v_op_rarity
      and photo_url is not null
      and user_id <> v_user
    order by random()
    limit 1;

  -- Cascade 2: any spot of target rarity with a photo
  if not found then
    select * into v_op_spot from public.spots
      where rarity = v_op_rarity
        and photo_url is not null
      order by random()
      limit 1;
  end if;

  -- Cascade 3: any spot with a photo, drop the rarity constraint
  if not found then
    select * into v_op_spot from public.spots
      where photo_url is not null
      order by random()
      limit 1;
  end if;

  if found then
    v_op_hp := public.race_card_horsepower(v_op_spot.id);
    v_op_spot_id := v_op_spot.id;
    v_op := jsonb_build_object(
      'brand',      v_op_spot.brand,
      'model',      v_op_spot.model,
      'rarity',     coalesce(v_op_spot.rarity, 'standard'),
      'horsepower', v_op_hp,
      'photo_url',  v_op_spot.photo_url,
      'spot_id',    v_op_spot.id,
      'year',       v_op_spot.year
    );
  else
    -- Cascade 4: synthetic. Empty DB or no photo-bearing spots.
    v_op_hp := case v_op_rarity
      when 'hypercar'    then 800
      when 'supercar'    then 600
      when 'exclusif'    then 500
      when 'performance' then 400
      when 'premium'     then 300
      else                    200  -- standard
    end;
    v_op_hp := (v_op_hp * (0.85 + random() * 0.30))::int;
    v_op_spot_id := null;
    v_op := jsonb_build_object(
      'brand',      'Phantom',
      'model',      'AI Spec',
      'rarity',     v_op_rarity,
      'horsepower', v_op_hp,
      'photo_url',  null,
      'spot_id',    null,
      'year',       null
    );
  end if;

  -- ────── Stake roll — unchanged from 0038 ──────
  v_seed  := random();
  v_seed2 := random();
  if v_seed < 0.60 then
    if v_seed2 < 0.34 then
      v_stake_type := 'xp_25';  v_stake_value := jsonb_build_object('amount', 25,  'label', '+25 XP');
    elsif v_seed2 < 0.67 then
      v_stake_type := 'xp_50';  v_stake_value := jsonb_build_object('amount', 50,  'label', '+50 XP');
    else
      v_stake_type := 'xp_75';  v_stake_value := jsonb_build_object('amount', 75,  'label', '+75 XP');
    end if;
  elsif v_seed < 0.85 then
    if v_seed2 < 0.34 then
      v_stake_type := 'xp_100'; v_stake_value := jsonb_build_object('amount', 100, 'label', '+100 XP');
    elsif v_seed2 < 0.67 then
      v_stake_type := 'xp_150'; v_stake_value := jsonb_build_object('amount', 150, 'label', '+150 XP');
    else
      v_stake_type := 'xp_200'; v_stake_value := jsonb_build_object('amount', 200, 'label', '+200 XP');
    end if;
  elsif v_seed < 0.97 then
    v_stake_type := 'xp_400';   v_stake_value := jsonb_build_object('amount', 400, 'label', '+400 XP');
  else
    v_stake_type := 'xp_1000';  v_stake_value := jsonb_build_object('amount', 1000, 'label', '+1000 XP');
  end if;

  insert into public.races (
    player1_id, player1_card_id, player2_card_id, player2_ai,
    reward_type, reward_value, status
  )
  values (
    v_user, p_card_id, v_op_spot_id, v_op,
    v_stake_type, v_stake_value, 'pending'
  )
  returning id into v_race_id;

  return query select v_race_id, v_hp, v_op, v_stake_type, v_stake_value;
end;
$$;

grant execute on function public.start_race(uuid) to authenticated;

commit;
