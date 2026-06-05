-- ──────────────── Adaptive challenges — move auto-claim to per-user ────────────────
-- Companion to 0042. Apply: node scripts/apply-rls.mjs supabase/0043-adaptive-autoclaim.sql
--
-- The real XP economy is driven by a trigger on `spots` (0035), NOT by a
-- manual claim — when a user posts a spot, the trigger awards XP for any
-- GLOBAL challenge whose target was met. 0042 added per-user adaptive
-- challenges + a manual claim_weekly_challenge, but since claiming is
-- automatic, the per-user challenges would display and never reward.
--
-- This migration repoints the spots trigger at the per-user tables:
--   • adds _for(p_user) variants of assign/roll so they work outside an
--     auth.uid() context (the trigger runs as the posting user, but we
--     pass the id explicitly to be safe),
--   • rewires the public auth.uid() wrappers to delegate to them,
--   • replaces the auto-claim trigger to award XP against each user's
--     SCALED weekly target (race-safe via a conditional UPDATE…RETURNING).
--
-- The old global function `auto_claim_challenges_on_spot` is left in
-- place (just unbound) so rollback = recreate the old trigger on it.

-- ─────────────────── _for(p_user) cores ───────────────────
create or replace function public.roll_user_difficulty_for(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week    date := date_trunc('week', now())::date;
  v_prev    date := (date_trunc('week', now()) - interval '7 days')::date;
  v_level   int;
  v_rolled  date;
  v_done    int;
  v_assigned int;
begin
  if p_user is null then return; end if;

  insert into public.user_challenge_difficulty (user_id) values (p_user)
    on conflict (user_id) do nothing;

  select level, last_rolled_week into v_level, v_rolled
    from public.user_challenge_difficulty where user_id = p_user;

  if v_rolled is not null and v_rolled >= v_week then return; end if;

  select count(*) into v_assigned
    from public.user_weekly_challenges where user_id = p_user and week_start = v_prev;

  if v_assigned > 0 then
    select count(*) into v_done
    from public.user_weekly_challenges uwc
    join public.challenges c on c.id = uwc.challenge_id
    where uwc.user_id = p_user and uwc.week_start = v_prev
      and public.revs_challenge_progress(
            p_user, c, v_prev::timestamptz, (v_prev + 7)::timestamptz
          ) >= uwc.scaled_target;

    if v_done >= 2 then
      v_level := least(4, v_level + 1);
    elsif v_done = 0 then
      v_level := greatest(0, v_level - 1);
    end if;
  end if;

  update public.user_challenge_difficulty
    set level = v_level, last_rolled_week = v_week, updated_at = now()
    where user_id = p_user;
end;
$$;
grant execute on function public.roll_user_difficulty_for(uuid) to authenticated;

create or replace function public.assign_weekly_challenges_for(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week  date := date_trunc('week', now())::date;
  v_level int;
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

  insert into public.user_weekly_challenges
    (user_id, week_start, challenge_id, slot, scaled_target)
  select p_user, v_week, c.id,
         (row_number() over () - 1)::int as slot,
         public.revs_scaled_target(c.target_value, v_level)
  from (
    select id, target_value from public.challenges order by random() limit 3
  ) c;
end;
$$;
grant execute on function public.assign_weekly_challenges_for(uuid) to authenticated;

-- ─────────────── Public auth.uid() wrappers delegate to _for ───────────────
create or replace function public.roll_user_difficulty()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.roll_user_difficulty_for(auth.uid());
end;
$$;

create or replace function public.assign_weekly_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assign_weekly_challenges_for(auth.uid());
end;
$$;

-- ─────────────── Per-user auto-claim trigger ───────────────
-- On every spot insert: ensure the poster has an assignment for the
-- spot's week, then award XP for any of their weekly challenges whose
-- SCALED target is now met. The conditional UPDATE…RETURNING guarantees
-- XP is emitted exactly once even under concurrent spot inserts.
create or replace function public.auto_claim_weekly_challenges_on_spot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := new.user_id;
  v_week date := date_trunc('week', new.created_at)::date;
  c      record;
  v_progress int;
begin
  perform public.assign_weekly_challenges_for(v_user);

  for c in
    select uwc.challenge_id, uwc.scaled_target,
           ch.type, ch.target_brand, ch.target_category, ch.xp_reward, ch.title
    from public.user_weekly_challenges uwc
    join public.challenges ch on ch.id = uwc.challenge_id
    where uwc.user_id = v_user
      and uwc.week_start = v_week
      and uwc.claimed = false
  loop
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
      with claim as (
        update public.user_weekly_challenges
        set claimed = true, completed_at = now()
        where user_id = v_user and week_start = v_week
          and challenge_id = c.challenge_id and claimed = false
        returning challenge_id
      )
      insert into public.xp_transactions (user_id, amount, reason)
      select v_user, c.xp_reward, 'challenge:' || c.title
      from claim;
    end if;
  end loop;

  return new;
end;
$$;

-- Swap the trigger from the global function to the per-user one. Keeping
-- both active would double-award (global + per-user), so we replace.
drop trigger if exists trg_auto_claim_challenges on public.spots;
drop trigger if exists trg_auto_claim_weekly_challenges on public.spots;
create trigger trg_auto_claim_weekly_challenges
after insert on public.spots
for each row
execute function public.auto_claim_weekly_challenges_on_spot();

notify pgrst, 'reload schema';
