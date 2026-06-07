-- ───────────────────────── Card Level-Up engine ─────────────────────────
-- A "card" = (user_id, normalized brand, normalized model). Each VALID
-- spot of that model progresses the card through 5 levels:
--   L1 Rookie (1) · L2 Challenger (3) · L3 Veteran (6) · L4 Legend (11)
--   · L5 Master (21)   ← thresholds are CUMULATIVE valid spots.
--
-- Permanent XP multiplier earned by the card, applied to every FUTURE
-- spot of that model:  L>=4 → x1.5,  L>=2 → x1.1,  else x1.0.
--
-- Anti-farm barrier — a re-spot only counts as a VALID duplicate (and
-- so progresses the card) when it is, vs the user's last valid spot of
-- that model, EITHER more than 12 h later OR more than 500 m away.
-- A non-conforming duplicate still earns its base XP (you did spot a
-- car) but does NOT progress the card.
--
-- Source of truth = the materialized table below, updated inside the
-- existing AFTER-INSERT trigger award_xp_spot() (bound by schema.sql as
-- trg_xp_spot). Daily-first / streak bonuses are preserved verbatim.
--
-- Apply: node scripts/apply-rls.mjs supabase/0044-card-progress.sql

begin;

-- ──────────────── 1. Table ────────────────
create table if not exists public.card_progress (
  user_id        uuid not null references auth.users (id) on delete cascade,
  brand_key      text not null,
  model_key      text not null,
  brand          text not null,
  model          text not null,
  valid_count    int  not null default 1 check (valid_count > 0),
  level          int  not null default 1 check (level between 1 and 5),
  last_spot_at   timestamptz not null default now(),
  last_lat       double precision,
  last_lng       double precision,
  best_photo_url text,
  title          text,           -- unique L5 title, else null
  updated_at     timestamptz not null default now(),
  primary key (user_id, brand_key, model_key)
);

alter table public.card_progress enable row level security;

-- Read-own only. All writes go through the SECURITY DEFINER trigger, so
-- there is intentionally no INSERT/UPDATE policy for clients.
drop policy if exists "card_progress read own" on public.card_progress;
create policy "card_progress read own"
  on public.card_progress for select to authenticated
  using (user_id = auth.uid());

-- ──────────────── 2. Helper functions ────────────────

-- Normalize a brand/model string for stable card identity matching.
create or replace function public.card_norm(s text)
returns text language sql immutable as $$
  select lower(trim(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g')))
$$;

-- Cumulative-valid-count → level. Keep in sync with src/lib/cardLevels.ts.
create or replace function public.card_level_for(p_count int)
returns int language sql immutable as $$
  select case
    when p_count >= 21 then 5
    when p_count >= 11 then 4
    when p_count >= 6  then 3
    when p_count >= 3  then 2
    else 1
  end
$$;

-- Permanent XP multiplier for a given card level.
create or replace function public.card_xp_multiplier(p_level int)
returns numeric language sql immutable as $$
  select case
    when p_level >= 4 then 1.5
    when p_level >= 2 then 1.1
    else 1.0
  end
$$;

-- Haversine distance in metres (the trigger is SQL — it cannot call the
-- JS distanceMeters in src/lib/spots.ts).
create or replace function public.card_distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ──────────────── 3. award_xp_spot() rewrite ────────────────
-- Folds card progression + permanent XP multiplier into the existing
-- spot-XP trigger. Base/daily/streak logic from 0040 preserved verbatim;
-- only the base-spot insert now multiplies by the card's earned factor,
-- and a card_progress upsert is appended.
create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  r              text := coalesce(new.rarity, 'standard');
  base_xp        int;
  v_today_count  int;
  v_yesterday    int;
  day_start      timestamptz := date_trunc('day', new.created_at);
  v_bkey         text := public.card_norm(new.brand);
  v_mkey         text := public.card_norm(new.model);
  v_card         public.card_progress%rowtype;
  v_has_card     boolean := false;
  v_mult         numeric := 1.0;
  v_valid_dup    boolean;
  v_new_count    int;
  v_new_level    int;
begin
  base_xp := case r
    when 'hypercar'    then 250
    when 'supercar'    then 150
    when 'exclusif'    then 90
    when 'performance' then 50
    when 'premium'     then 25
    else                    10  -- standard
  end;

  -- Card state BEFORE this spot → the permanent multiplier it earned.
  if v_bkey <> '' and v_mkey <> '' then
    select * into v_card from public.card_progress
      where user_id = new.user_id
        and brand_key = v_bkey
        and model_key = v_mkey;
    if found then
      v_has_card := true;
      v_mult := public.card_xp_multiplier(v_card.level);
    end if;
  end if;

  -- Base spot XP × earned multiplier.
  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, round(base_xp * v_mult)::int, 'spot');

  -- Daily-first (+10) and streak (+5) — unchanged, never multiplied.
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

  -- ── Card progression ──
  if v_bkey <> '' and v_mkey <> '' then
    if not v_has_card then
      -- First time this model is collected → level 1.
      insert into public.card_progress (
        user_id, brand_key, model_key, brand, model,
        valid_count, level, last_spot_at, last_lat, last_lng, best_photo_url
      ) values (
        new.user_id, v_bkey, v_mkey, new.brand, new.model,
        1, 1, new.created_at, new.lat, new.lng, new.photo_url
      )
      on conflict (user_id, brand_key, model_key) do nothing;
    else
      -- Anti-farm barrier: valid duplicate iff >12h OR >500m from the
      -- last valid spot of this model (or last coords unknown).
      v_valid_dup :=
        (new.created_at - v_card.last_spot_at > interval '12 hours')
        or v_card.last_lat is null
        or v_card.last_lng is null
        or public.card_distance_m(
             v_card.last_lat, v_card.last_lng, new.lat, new.lng
           ) > 500;

      if v_valid_dup then
        v_new_count := v_card.valid_count + 1;
        v_new_level := public.card_level_for(v_new_count);
        update public.card_progress set
          valid_count    = v_new_count,
          level          = v_new_level,
          last_spot_at   = new.created_at,
          last_lat       = new.lat,
          last_lng       = new.lng,
          best_photo_url = coalesce(new.photo_url, best_photo_url),
          title = case
                    when v_new_level >= 5 and title is null
                      then 'Maître de la ' || new.model
                    else title
                  end,
          updated_at     = now()
        where user_id = new.user_id
          and brand_key = v_bkey
          and model_key = v_mkey;
      end if;
      -- Non-conforming duplicate: base XP already granted, no progress.
    end if;
  end if;

  return new;
end; $$;

-- ──────────────── 4. One-time backfill ────────────────
-- Seed card_progress from existing spots so current collectors keep the
-- levels they already earned. This baseline counts ALL historical spots
-- per model (it does NOT replay the 12h/500m barrier — order-dependent
-- and not worth reconstructing); future spots apply the strict barrier.
insert into public.card_progress (
  user_id, brand_key, model_key, brand, model,
  valid_count, level, last_spot_at, last_lat, last_lng, best_photo_url, title
)
select
  s.user_id,
  public.card_norm(s.brand),
  public.card_norm(s.model),
  (array_agg(s.brand order by s.created_at desc))[1],
  (array_agg(s.model order by s.created_at desc))[1],
  count(*)::int,
  public.card_level_for(count(*)::int),
  max(s.created_at),
  (array_agg(s.lat       order by s.created_at desc))[1],
  (array_agg(s.lng       order by s.created_at desc))[1],
  (array_agg(s.photo_url order by s.created_at desc))[1],
  case when public.card_level_for(count(*)::int) >= 5
       then 'Maître de la ' || (array_agg(s.model order by s.created_at desc))[1]
       else null end
from public.spots s
where coalesce(public.card_norm(s.brand), '') <> ''
  and coalesce(public.card_norm(s.model), '') <> ''
group by s.user_id, public.card_norm(s.brand), public.card_norm(s.model)
on conflict (user_id, brand_key, model_key) do nothing;

commit;

notify pgrst, 'reload schema';
