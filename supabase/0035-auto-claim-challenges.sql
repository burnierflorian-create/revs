-- ─────────────────────── Auto-claim weekly challenges ───────────────────────
-- Replaces the manual "Réclamer" button. Whenever a user posts a spot,
-- we recompute their progress on every active challenge and atomically
-- close + reward any that just crossed the target.
--
-- Atomicity uses ON CONFLICT DO NOTHING on user_challenges (the PK is
-- (user_id, challenge_id)) combined with a CTE so the xp_transactions
-- INSERT only fires for the run that actually wrote the claim row.
-- This is race-safe under concurrent spot inserts even if both
-- branches passed the "not exists" filter.

create or replace function public.auto_claim_challenges_on_spot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := new.user_id;
  v_now  timestamptz := new.created_at;
  c      record;
  v_progress int;
begin
  for c in
    select id, type, target_value, target_brand, target_category,
           xp_reward, title, starts_at, ends_at
    from public.challenges
    where active = true
      and v_now >= starts_at
      and v_now <  ends_at
      and not exists (
        select 1 from public.user_challenges uc
        where uc.user_id = v_user and uc.challenge_id = challenges.id
      )
  loop
    select count(*) into v_progress
    from public.spots s
    where s.user_id = v_user
      and s.created_at >= c.starts_at
      and s.created_at <  c.ends_at
      and (
        (c.type = 'spot_count')
        or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
        or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
      );

    if v_progress >= c.target_value then
      with claim as (
        insert into public.user_challenges (user_id, challenge_id)
        values (v_user, c.id)
        on conflict do nothing
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

drop trigger if exists trg_auto_claim_challenges on public.spots;
create trigger trg_auto_claim_challenges
after insert on public.spots
for each row
execute function public.auto_claim_challenges_on_spot();

-- ─────────────────────── One-shot backfill ───────────────────────
-- For any user whose progress already met the target before this
-- trigger existed but who never tapped "Réclamer". Same atomic CTE
-- pattern — XP only emitted for newly-inserted claim rows.

with progress as (
  select s.user_id,
         c.id           as challenge_id,
         c.target_value,
         c.xp_reward,
         c.title,
         count(*)       as cnt
  from public.challenges c
  join public.spots s
    on s.created_at >= c.starts_at
   and s.created_at <  c.ends_at
   and (
        (c.type = 'spot_count')
        or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
        or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
      )
  where c.active = true
  group by s.user_id, c.id, c.target_value, c.xp_reward, c.title
),
eligible as (
  select * from progress where cnt >= target_value
),
newly_claimed as (
  insert into public.user_challenges (user_id, challenge_id)
  select user_id, challenge_id from eligible
  on conflict do nothing
  returning user_id, challenge_id
)
insert into public.xp_transactions (user_id, amount, reason)
select n.user_id, e.xp_reward, 'challenge:' || e.title
from newly_claimed n
join eligible e
  on e.user_id = n.user_id and e.challenge_id = n.challenge_id;
