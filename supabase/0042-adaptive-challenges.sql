-- ───────────────────── Adaptive weekly challenges (Part 3) ─────────────────────
-- DRAFT FOR REVIEW — NOT YET APPLIED.
-- Apply (only once approved): node scripts/apply-rls.mjs supabase/0042-adaptive-challenges.sql
--
-- Moves weekly challenges from the current GLOBAL/static model (3 random
-- challenges, same for everyone, fixed targets) to a PER-USER ADAPTIVE
-- model whose targets ramp with the user's recent performance.
--
-- Design goals:
--   • Reuse the existing `challenges` pool (the 14 templates) untouched.
--   • Keep the legacy global system (activate_weekly_challenges /
--     get_active_challenges / claim_challenge) intact so nothing breaks
--     mid-migration — the frontend simply switches to the new RPCs.
--   • Retain weekly history so difficulty can read "last week".
--   • Never frustrate: difficulty eases down on a dead week.
--   • XP rewards stay at the template's base value (difficulty does not
--     inflate XP) so the economy can't be farmed by ramping.
--
-- Reversible: drop the two tables + four functions below and revert
-- src/lib/challenges.ts to the get_active_challenges / claim_challenge
-- calls.

-- ─────────────────────── State: per-user difficulty ───────────────────────
create table if not exists public.user_challenge_difficulty (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  level           int  not null default 0 check (level between 0 and 4),
  last_rolled_week date,            -- Monday of the last week we adjusted
  updated_at      timestamptz not null default now()
);

alter table public.user_challenge_difficulty enable row level security;
drop policy if exists "ucd read own" on public.user_challenge_difficulty;
create policy "ucd read own"
  on public.user_challenge_difficulty for select to authenticated
  using (user_id = auth.uid());

-- ─────────────── Assignment + history: per-user weekly set ───────────────
-- One row per (user, week, challenge). This table is BOTH the current
-- assignment and the permanent history that the rollover reads.
create table if not exists public.user_weekly_challenges (
  user_id       uuid not null references auth.users (id) on delete cascade,
  week_start    date not null,                          -- Monday 00:00
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  slot          int  not null check (slot between 0 and 2),
  scaled_target int  not null check (scaled_target >= 1), -- this user's goal
  claimed       boolean not null default false,
  completed_at  timestamptz,
  assigned_at   timestamptz not null default now(),
  primary key (user_id, week_start, challenge_id)
);

create index if not exists uwc_user_week_idx
  on public.user_weekly_challenges (user_id, week_start);

alter table public.user_weekly_challenges enable row level security;
drop policy if exists "uwc read own" on public.user_weekly_challenges;
create policy "uwc read own"
  on public.user_weekly_challenges for select to authenticated
  using (user_id = auth.uid());

-- ─────────────────────── Scaling curve ───────────────────────
-- base + floor(base * level / 4). Tuned so a base-5 challenge reaches 10
-- at max level (the "5 → 10" example), and single-spot challenges grow
-- gently (1 → 2). Pure, immutable.
create or replace function public.revs_scaled_target(p_base int, p_level int)
returns int
language sql
immutable
as $$
  select greatest(1, p_base + floor(p_base * greatest(0, least(4, p_level)) / 4.0)::int);
$$;

-- ─────────────────────── Progress helper ───────────────────────
-- Counts a user's qualifying spots inside [p_from, p_to) for a challenge.
create or replace function public.revs_challenge_progress(
  p_user uuid, p_challenge public.challenges, p_from timestamptz, p_to timestamptz
) returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::int
  from public.spots s
  where s.user_id = p_user
    and s.created_at >= p_from
    and s.created_at <  p_to
    and (
      (p_challenge.type = 'spot_count')
      or (p_challenge.type = 'spot_brand'    and lower(s.brand)    = lower(p_challenge.target_brand))
      or (p_challenge.type = 'spot_category' and lower(s.category) = lower(p_challenge.target_category))
    );
$$;

-- ─────────────────────── Difficulty rollover ───────────────────────
-- Adjusts the caller's level based on LAST week's completion, at most
-- once per week. ≥2/3 done → +1 (cap 4). 0/3 done → -1 (floor 0, eases
-- the next week). 1/3 → unchanged. Safe to call repeatedly.
create or replace function public.roll_user_difficulty()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_week      date := date_trunc('week', now())::date;
  v_prev      date := (date_trunc('week', now()) - interval '7 days')::date;
  v_level     int;
  v_rolled    date;
  v_done      int;
  v_assigned  int;
begin
  if v_user is null then return; end if;

  insert into public.user_challenge_difficulty (user_id) values (v_user)
    on conflict (user_id) do nothing;

  select level, last_rolled_week into v_level, v_rolled
    from public.user_challenge_difficulty where user_id = v_user;

  -- Already adjusted for this week, or no history yet → nothing to do.
  if v_rolled is not null and v_rolled >= v_week then return; end if;

  select count(*) into v_assigned
    from public.user_weekly_challenges where user_id = v_user and week_start = v_prev;

  if v_assigned > 0 then
    -- Recompute last week's completions against each row's scaled target.
    select count(*) into v_done
    from public.user_weekly_challenges uwc
    join public.challenges c on c.id = uwc.challenge_id
    where uwc.user_id = v_user and uwc.week_start = v_prev
      and public.revs_challenge_progress(
            v_user, c, v_prev::timestamptz, (v_prev + 7)::timestamptz
          ) >= uwc.scaled_target;

    if v_done >= 2 then
      v_level := least(4, v_level + 1);
    elsif v_done = 0 then
      v_level := greatest(0, v_level - 1);
    end if;
  end if;

  update public.user_challenge_difficulty
    set level = v_level, last_rolled_week = v_week, updated_at = now()
    where user_id = v_user;
end;
$$;

grant execute on function public.roll_user_difficulty() to authenticated;

-- ─────────────────────── Weekly assignment ───────────────────────
-- Ensures the caller has 3 challenges assigned for the current week,
-- scaled to their (freshly rolled) difficulty. Idempotent per week.
create or replace function public.assign_weekly_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_week  date := date_trunc('week', now())::date;
  v_level int;
begin
  if v_user is null then return; end if;

  -- Roll difficulty from last week first, so this week uses the new level.
  perform public.roll_user_difficulty();

  -- Already assigned this week → no-op.
  if exists (
    select 1 from public.user_weekly_challenges
    where user_id = v_user and week_start = v_week
  ) then
    return;
  end if;

  select level into v_level from public.user_challenge_difficulty where user_id = v_user;
  v_level := coalesce(v_level, 0);

  -- Pick 3 distinct templates at random and assign scaled targets.
  insert into public.user_weekly_challenges
    (user_id, week_start, challenge_id, slot, scaled_target)
  select v_user, v_week, c.id,
         (row_number() over () - 1)::int as slot,
         public.revs_scaled_target(c.target_value, v_level)
  from (
    select id, target_value from public.challenges order by random() limit 3
  ) c;
end;
$$;

grant execute on function public.assign_weekly_challenges() to authenticated;

-- ─────────────────────── Read: my weekly challenges ───────────────────────
-- Same column shape as get_active_challenges so the frontend swaps the
-- RPC name only. target_value here is the user's SCALED target.
create or replace function public.get_my_weekly_challenges()
returns table (
  id              uuid,
  title           text,
  description     text,
  type            text,
  target_value    integer,
  target_brand    text,
  target_category text,
  xp_reward       integer,
  starts_at       timestamptz,
  ends_at         timestamptz,
  progress        integer,
  completed       boolean,
  claimed         boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
begin
  if v_user is null then return; end if;

  perform public.assign_weekly_challenges();

  return query
    select
      c.id, c.title, c.description, c.type,
      uwc.scaled_target as target_value,
      c.target_brand, c.target_category, c.xp_reward,
      v_week::timestamptz as starts_at,
      (v_week + 7)::timestamptz as ends_at,
      public.revs_challenge_progress(
        v_user, c, v_week::timestamptz, (v_week + 7)::timestamptz
      ) as progress,
      public.revs_challenge_progress(
        v_user, c, v_week::timestamptz, (v_week + 7)::timestamptz
      ) >= uwc.scaled_target as completed,
      uwc.claimed
    from public.user_weekly_challenges uwc
    join public.challenges c on c.id = uwc.challenge_id
    where uwc.user_id = v_user and uwc.week_start = v_week
    order by uwc.slot;
end;
$$;

grant execute on function public.get_my_weekly_challenges() to authenticated;

-- ─────────────────────── Claim: my weekly challenge ───────────────────────
-- Awards the template's base xp_reward once the user's SCALED target is
-- met. Idempotent. Mirrors claim_challenge but reads the per-user goal.
create or replace function public.claim_weekly_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
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
  if not found or v_row.claimed then
    return false;
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then return false; end if;

  v_progress := public.revs_challenge_progress(
    v_user, v_challenge, v_week::timestamptz, (v_week + 7)::timestamptz
  );
  if v_progress < v_row.scaled_target then
    return false;
  end if;

  update public.user_weekly_challenges
    set claimed = true, completed_at = now()
    where user_id = v_user and week_start = v_week and challenge_id = p_challenge_id;

  insert into public.xp_transactions (user_id, amount, reason)
    values (v_user, v_challenge.xp_reward, 'challenge:' || v_challenge.title);

  return true;
end;
$$;

grant execute on function public.claim_weekly_challenge(uuid) to authenticated;

notify pgrst, 'reload schema';
