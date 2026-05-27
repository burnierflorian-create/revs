-- ─────────────────────── REVS RACE — real-photo opponents ───────────────────────
-- Replaces the synthetic opponent in start_race with a real spot
-- drawn from the public catalogue. Same weighted-rarity roll
-- (50/30/15/5) keeps gameplay balance regardless of the user
-- base's actual rarity distribution.
--
-- Fallback cascade (matches Phase 2 design decision):
--   1. spot of target rarity, owned by another user, with photo_url
--   2. spot of target rarity from anyone (incl. caller), with photo_url
--   3. spot of any rarity with photo_url
--   4. synthetic — only when DB has no usable spots at all
--
-- The opponent JSONB payload gains `photo_url`, `spot_id`, `year`
-- so the client can render the real photo on every race screen.
-- player2_card_id on the race row points to the picked spot (null
-- when we fell back to synthetic).

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

  -- Rarity bucket (gameplay balance — biased toward common tiers).
  v_seed := random();
  if v_seed < 0.50 then
    v_op_rarity := 'commun';
  elsif v_seed < 0.80 then
    v_op_rarity := 'rare';
  elsif v_seed < 0.95 then
    v_op_rarity := 'ultra_rare';
  else
    v_op_rarity := 'unique';
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
      'rarity',     coalesce(v_op_spot.rarity, 'commun'),
      'horsepower', v_op_hp,
      'photo_url',  v_op_spot.photo_url,
      'spot_id',    v_op_spot.id,
      'year',       v_op_spot.year
    );
  else
    -- Cascade 4: synthetic. Empty DB or no photo-bearing spots.
    v_op_hp := case v_op_rarity
      when 'unique' then 700 when 'ultra_rare' then 500
      when 'rare'   then 350 else 200
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

  -- ────── Stake roll — unchanged from 0037 ──────
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
