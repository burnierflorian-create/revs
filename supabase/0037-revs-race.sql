-- ─────────────────────── REVS RACE — Phase 1 ───────────────────────
-- Solo drag race against an AI opponent. Multiplayer matchmaking,
-- borrowed cards, push rewards, custom card borders and timed XP
-- multipliers defer to Phase 2. Phase 1 collapses all reward types
-- into instant +XP credits — the user-facing labels still mention
-- the original tier, but the underlying mechanic is a flat
-- xp_transactions write.

create table if not exists public.races (
  id              uuid primary key default gen_random_uuid(),
  player1_id      uuid not null references auth.users(id) on delete cascade,
  -- Null in Phase 1 — every opponent is an AI synthetic. Multiplayer
  -- in Phase 2 will populate this.
  player2_id      uuid references auth.users(id) on delete cascade,
  player1_card_id uuid references public.spots(id) on delete set null,
  player2_card_id uuid references public.spots(id) on delete set null,
  -- AI opponent payload: {brand, model, rarity, horsepower}
  player2_ai      jsonb,
  player1_score          integer,
  player2_score          integer,
  player1_timing_bucket  text,         -- 'perfect' | 'good' | 'miss' | 'false_start'
  player1_timing_ms      integer,
  winner_id              uuid references auth.users(id) on delete set null,
  -- Stake decided at start time, applied at resolve if player wins.
  reward_type            text,
  reward_value           jsonb,
  status                 text not null default 'pending'
                         check (status in ('pending', 'resolved', 'forfeit')),
  started_at             timestamptz not null default now(),
  resolved_at            timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists races_player1_idx
  on public.races (player1_id, created_at desc);

alter table public.races enable row level security;

drop policy if exists "races read own" on public.races;
create policy "races read own"
  on public.races for select
  to authenticated
  using (player1_id = auth.uid() or player2_id = auth.uid());

-- ─────────────────────── race_rewards ───────────────────────
-- Future-proofing table for timed/consumable rewards. Phase 1 writes
-- nothing here (all rewards are instant XP transactions) but the
-- schema is laid down so Phase 2 multiplier / borrowed-card logic
-- doesn't need a migration.

create table if not exists public.race_rewards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  race_id      uuid references public.races(id) on delete set null,
  reward_type  text not null,
  reward_value jsonb,
  expires_at   timestamptz,
  used         boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists race_rewards_user_idx
  on public.race_rewards (user_id, created_at desc);

alter table public.race_rewards enable row level security;
drop policy if exists "race_rewards read own" on public.race_rewards;
create policy "race_rewards read own"
  on public.race_rewards for select
  to authenticated
  using (user_id = auth.uid());

-- ─────────────────────── helpers ───────────────────────

-- Effective horsepower for a card. Prefer the Claude-fetched specs
-- when available; otherwise fall back to a synthetic baseline derived
-- from rarity so racing isn't blocked by a missing spec lookup.
create or replace function public.race_card_horsepower(p_card_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot public.spots%rowtype;
  v_specs jsonb;
  v_hp text;
  v_n integer;
  v_slug text;
begin
  select * into v_spot from public.spots where id = p_card_id;
  if not found then return 200; end if;

  v_slug := lower(regexp_replace(v_spot.brand, '[^A-Za-z0-9]+', '-', 'g'))
         || '|' || lower(regexp_replace(v_spot.model, '[^A-Za-z0-9]+', '-', 'g'))
         || '|' || coalesce(v_spot.year::text, 'na');

  select data into v_specs
    from public.car_specs
   where slug = v_slug
   limit 1;

  if v_specs is not null then
    v_hp := coalesce(v_specs->>'horsepower', '');
    v_n := nullif(regexp_replace(v_hp, '[^0-9]', '', 'g'), '')::integer;
    if v_n is not null and v_n between 50 and 2500 then
      return v_n;
    end if;
  end if;

  return case coalesce(v_spot.rarity, 'commun')
    when 'unique'     then 700
    when 'ultra_rare' then 500
    when 'rare'       then 350
    else                   200
  end;
end;
$$;

grant execute on function public.race_card_horsepower(uuid) to authenticated;

-- ─────────────────────── start_race ───────────────────────
-- Picks a synthetic AI opponent, rolls the stake from the weighted
-- catalogue, inserts a pending race row, and returns everything the
-- client needs to render the pre-race screen. AI rarity is biased
-- toward lower tiers so Commun-card players still win sometimes.

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
  v_op_base   integer;
  v_op_hp     integer;
  v_op_brand  text;
  v_op_model  text;
  v_op        jsonb;
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

  -- AI rarity weighted toward common tiers (50/30/15/5).
  v_seed := random();
  if v_seed < 0.50 then
    v_op_rarity := 'commun';     v_op_base := 200;
  elsif v_seed < 0.80 then
    v_op_rarity := 'rare';       v_op_base := 350;
  elsif v_seed < 0.95 then
    v_op_rarity := 'ultra_rare'; v_op_base := 500;
  else
    v_op_rarity := 'unique';     v_op_base := 700;
  end if;
  v_op_hp := (v_op_base * (0.85 + random() * 0.30))::integer;

  -- Synthetic brand/model — Phase 2 may swap this with real cars
  -- borrowed from other users.
  v_op_brand := (array['Ferrari','Lamborghini','Porsche','McLaren',
                       'Audi RS','BMW M','Mercedes-AMG','Aston Martin'])
                [floor(random()*8)::int + 1];
  v_op_model := (array['Stradale','Veloce','GT3 RS','Performante',
                       'Senna','Aventador','SF90','911 Turbo S'])
                [floor(random()*8)::int + 1];

  v_op := jsonb_build_object(
    'brand',      v_op_brand,
    'model',      v_op_model,
    'rarity',     v_op_rarity,
    'horsepower', v_op_hp
  );

  -- Stake weighted 60/25/12/3. Phase 1: every reward is instant XP
  -- (multipliers / borrows / pins / push / custom border are Phase 2).
  v_seed  := random();
  v_seed2 := random();
  if v_seed < 0.60 then
    -- Commun
    if v_seed2 < 0.34 then
      v_stake_type := 'xp_25';  v_stake_value := jsonb_build_object('amount', 25,  'label', '+25 XP');
    elsif v_seed2 < 0.67 then
      v_stake_type := 'xp_50';  v_stake_value := jsonb_build_object('amount', 50,  'label', '+50 XP');
    else
      v_stake_type := 'xp_75';  v_stake_value := jsonb_build_object('amount', 75,  'label', '+75 XP');
    end if;
  elsif v_seed < 0.85 then
    -- Rare
    if v_seed2 < 0.34 then
      v_stake_type := 'xp_100'; v_stake_value := jsonb_build_object('amount', 100, 'label', '+100 XP');
    elsif v_seed2 < 0.67 then
      v_stake_type := 'xp_150'; v_stake_value := jsonb_build_object('amount', 150, 'label', '+150 XP');
    else
      v_stake_type := 'xp_200'; v_stake_value := jsonb_build_object('amount', 200, 'label', '+200 XP');
    end if;
  elsif v_seed < 0.97 then
    -- Ultra rare
    v_stake_type := 'xp_400';   v_stake_value := jsonb_build_object('amount', 400, 'label', '+400 XP');
  else
    -- Légendaire
    v_stake_type := 'xp_1000';  v_stake_value := jsonb_build_object('amount', 1000, 'label', '+1000 XP');
  end if;

  insert into public.races (
    player1_id, player1_card_id, player2_ai,
    reward_type, reward_value, status
  )
  values (v_user, p_card_id, v_op, v_stake_type, v_stake_value, 'pending')
  returning id into v_race_id;

  return query select v_race_id, v_hp, v_op, v_stake_type, v_stake_value;
end;
$$;

grant execute on function public.start_race(uuid) to authenticated;

-- ─────────────────────── resolve_race ───────────────────────
-- Player submits their tap delta (ms after GO). Server computes
-- scores from horsepower × rarity × timing, writes the result on
-- the race row, applies XP rewards. Returns everything the client
-- needs to render the result screen.
--
-- Timing buckets:
--   < 0        false_start  ×0.5  (tap before GO — penalty)
--   0..300     perfect      ×1.2
--   301..700   good         ×1.1
--   > 700      miss         ×1.0

create or replace function public.resolve_race(
  p_race_id      uuid,
  p_tap_delta_ms integer
)
returns table (
  player_score    integer,
  opponent_score  integer,
  winner_is_me    boolean,
  timing_bucket   text,
  timing_mult     numeric,
  reward_type     text,
  reward_value    jsonb,
  xp_awarded      integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_race public.races%rowtype;
  v_clamped int;
  v_p_timing_mult numeric;
  v_o_timing_mult numeric;
  v_timing_bucket text;
  v_p_hp int;
  v_o_hp int;
  v_p_rarity text;
  v_o_rarity text;
  v_p_rmult numeric;
  v_o_rmult numeric;
  v_p_score int;
  v_o_score int;
  v_winner uuid;
  v_xp int;
  v_amount int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_race from public.races
   where id = p_race_id and player1_id = v_user;
  if not found then raise exception 'race not found'; end if;
  if v_race.status <> 'pending' then
    raise exception 'race already resolved';
  end if;

  v_clamped := greatest(-200, least(2500, coalesce(p_tap_delta_ms, 2500)));
  if v_clamped < 0 then
    v_timing_bucket := 'false_start'; v_p_timing_mult := 0.5;
  elsif v_clamped <= 300 then
    v_timing_bucket := 'perfect';     v_p_timing_mult := 1.2;
  elsif v_clamped <= 700 then
    v_timing_bucket := 'good';        v_p_timing_mult := 1.1;
  else
    v_timing_bucket := 'miss';        v_p_timing_mult := 1.0;
  end if;

  -- AI gets a uniformly random timing bucket (1.0, 1.1, or 1.2).
  v_o_timing_mult := case (floor(random() * 3)::int)
    when 0 then 1.0 when 1 then 1.1 else 1.2
  end;

  v_p_hp := public.race_card_horsepower(v_race.player1_card_id);
  select coalesce(rarity, 'commun') into v_p_rarity
    from public.spots where id = v_race.player1_card_id;
  v_p_rmult := case v_p_rarity
    when 'unique'     then 4.0
    when 'ultra_rare' then 2.5
    when 'rare'       then 1.5
    else                   1.0
  end;

  v_o_hp := (v_race.player2_ai->>'horsepower')::int;
  v_o_rarity := v_race.player2_ai->>'rarity';
  v_o_rmult := case v_o_rarity
    when 'unique'     then 4.0
    when 'ultra_rare' then 2.5
    when 'rare'       then 1.5
    else                   1.0
  end;

  v_p_score := (v_p_hp * v_p_rmult * v_p_timing_mult)::int;
  v_o_score := (v_o_hp * v_o_rmult * v_o_timing_mult)::int;

  v_winner := case when v_p_score >= v_o_score then v_user else null end;

  update public.races
     set player1_score         = v_p_score,
         player2_score         = v_o_score,
         player1_timing_ms     = v_clamped,
         player1_timing_bucket = v_timing_bucket,
         winner_id             = v_winner,
         status                = 'resolved',
         resolved_at           = now()
   where id = p_race_id;

  if v_winner = v_user then
    v_amount := coalesce((v_race.reward_value->>'amount')::int, 0);
  else
    -- Consolation
    v_amount := 10;
  end if;

  if v_amount > 0 then
    insert into public.xp_transactions (user_id, amount, reason)
    values (
      v_user,
      v_amount,
      case when v_winner = v_user then 'race:win:' || v_race.reward_type
                                   else 'race:loss' end
    );
  end if;

  v_xp := v_amount;

  return query select
    v_p_score,
    v_o_score,
    (v_winner = v_user),
    v_timing_bucket,
    v_p_timing_mult,
    v_race.reward_type,
    v_race.reward_value,
    v_xp;
end;
$$;

grant execute on function public.resolve_race(uuid, integer) to authenticated;

-- ─────────────────────── race stats RPC ───────────────────────
-- Cheap aggregate for the badges system + future race history.
-- Single round-trip, cached client-side per Profile mount.

create or replace function public.get_user_race_stats(p_user uuid)
returns table (
  wins             integer,
  losses           integer,
  perfect_starts   integer
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where winner_id = p_user)::int                                       as wins,
    count(*) filter (where status = 'resolved' and winner_id is null)::int                as losses,
    count(*) filter (where player1_id = p_user and player1_timing_bucket = 'perfect')::int as perfect_starts
  from public.races
  where player1_id = p_user;
$$;

grant execute on function public.get_user_race_stats(uuid) to authenticated;
