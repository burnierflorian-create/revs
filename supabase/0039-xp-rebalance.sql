-- ─────────────────────── XP rebalance v2 ───────────────────────
-- Six things happen here, in order:
--   1. Wipe every existing xp_transactions row → everyone resets to 0.
--   2. Rewrite award_xp_spot() so XP per spot is a flat per-rarity
--      number (10 / 25 / 60 / 150), dropping the old price-tier × rarity
--      multiplier from 0027.
--   3. Inside the same trigger, add the daily-first-spot (+10) and the
--      daily streak (+5) bonuses. Both fire only when the row being
--      inserted is the user's first spot of the calendar day.
--   4. Rewrite award_xp_like() / revoke_xp_like() so each like is +1
--      XP (was +5), with a per-owner daily cap of 10 — beyond which
--      further likes don't credit anything. Revocation always returns
--      −1, even when the original insert was capped; this slight
--      asymmetry is acceptable for an XP rebalance.
--   5. Flatten every weekly challenge to xp_reward = 30, plus the
--      default so freshly-seeded challenges follow the new rule.
--   6. Flatten the daily challenge to 30 XP across the active row.
--
-- What stays alone, by scope:
--   - Collection rewards (0034) — long-tail goal, separate balance.
--   - Referral bonuses (0017) — acquisition lever, separate.
--   - Event XP — niche, low volume.
--   - REVS RACE rewards — lottery-style, balanced separately in 0037.

-- ─── 1. Wipe ───
-- xp_transactions uses uuid PKs so RESTART IDENTITY is a no-op; TRUNCATE
-- alone is enough and leaves every other table (spots, profiles, races,
-- challenges, etc.) untouched.
truncate table public.xp_transactions;

-- ─── 2 + 3. award_xp_spot rewrite (flat per rarity + daily/streak) ───
create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  r              text := coalesce(new.rarity, 'commun');
  base_xp        int;
  v_today_count  int;
  v_yesterday    int;
  day_start      timestamptz := date_trunc('day', new.created_at);
begin
  base_xp := case r
    when 'unique'     then 150
    when 'ultra_rare' then 60
    when 'rare'       then 25
    else                   10
  end;

  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, base_xp, 'spot');

  -- Daily-first-spot bonus + streak bonus. Both only land when the
  -- row being inserted is the first spot of `day_start` for the user.
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

-- The trigger itself is already wired from schema.sql; this CREATE OR
-- REPLACE swaps the function body in place. No DROP TRIGGER needed.

-- ─── 4. Like XP — +1, capped at 10/day per owner ───
create or replace function public.award_xp_like()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  owner       uuid;
  daily_like_xp int;
begin
  select user_id into owner from public.spots where id = new.spot_id;
  if owner is null then return new; end if;

  -- Sum the positive +1 entries from today (negatives from revokes
  -- don't count toward the cap, so cap reflects "received today").
  select coalesce(sum(amount), 0) into daily_like_xp
    from public.xp_transactions
   where user_id   = owner
     and reason    = 'like'
     and amount    > 0
     and created_at >= date_trunc('day', now());

  if daily_like_xp < 10 then
    insert into public.xp_transactions (user_id, amount, reason)
    values (owner, 1, 'like');
  end if;

  return new;
end; $$;

create or replace function public.revoke_xp_like()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from public.spots where id = old.spot_id;
  if owner is not null then
    insert into public.xp_transactions (user_id, amount, reason)
    values (owner, -1, 'like_removed');
  end if;
  return old;
end; $$;

-- ─── 5. Flatten weekly challenges to +30 XP ───
alter table public.challenges alter column xp_reward set default 30;
update public.challenges set xp_reward = 30 where xp_reward <> 30;

-- ─── 6. Flatten daily challenge to +30 XP ───
-- The daily_challenges table stores per-day generated rows; we
-- normalise the existing rows + the default so future generations
-- inherit it. The `check (xp_reward between 0 and 1000)` constraint
-- still holds.
alter table public.daily_challenges alter column xp_reward set default 30;
update public.daily_challenges set xp_reward = 30 where xp_reward <> 30;
