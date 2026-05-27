-- Per-user / per-day personalised mission. Generated lazily by the
-- car-info endpoint on first Home load of the day; claimed by tapping
-- "Relevé !" — the claim is single-shot per user/day and grants XP via
-- xp_transactions.
-- Apply: node scripts/apply-rls.mjs supabase/0033-daily-challenges.sql

create table if not exists public.daily_challenges (
  user_id      uuid not null references auth.users (id) on delete cascade,
  date         date not null,
  objective    text not null,
  xp_reward    int  not null default 100 check (xp_reward between 0 and 1000),
  completed_at timestamptz,
  generated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists daily_challenges_user_date_idx
  on public.daily_challenges (user_id, date desc);

alter table public.daily_challenges enable row level security;

drop policy if exists "daily challenges read own" on public.daily_challenges;

create policy "daily challenges read own"
  on public.daily_challenges for select to authenticated
  using (user_id = auth.uid());

-- claim_daily_challenge: single-shot per user/day. Marks the row as
-- completed and awards xp_reward XP. Returns (ok, xp). Idempotent —
-- subsequent calls return ok=false but the stored xp_reward so the UI
-- can keep showing the badge.
create or replace function public.claim_daily_challenge()
returns table (ok boolean, xp_reward int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := current_date;
  v_row public.daily_challenges%rowtype;
begin
  if v_user is null then
    return query select false, 0;
    return;
  end if;
  select * into v_row from public.daily_challenges
    where user_id = v_user and date = v_today;
  if not found then
    return query select false, 0;
    return;
  end if;
  if v_row.completed_at is not null then
    -- Already claimed today — return the original reward so the caller
    -- can still render the "Relevé ✓" state without an extra fetch.
    return query select false, v_row.xp_reward;
    return;
  end if;
  update public.daily_challenges
    set completed_at = now()
    where user_id = v_user and date = v_today;
  insert into public.xp_transactions (user_id, amount, reason)
    values (v_user, v_row.xp_reward, 'daily_challenge');
  return query select true, v_row.xp_reward;
end;
$$;

grant execute on function public.claim_daily_challenge() to authenticated;

notify pgrst, 'reload schema';
