-- ─────────────────────── Referral system ───────────────────────
-- Each profile gets a unique 6-char invite code. When user B signs
-- up and claims user A's code, both receive +50 XP. The claim is
-- single-shot per referred user (one inviter per account).

alter table public.profiles
  add column if not exists invite_code text;

-- Generate a 6-char code from a small alphabet (no ambiguous chars).
-- Used both for backfill and the auto-generate trigger below.
create or replace function public.gen_invite_code()
returns text
language plpgsql
as $$
declare
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_i     int;
begin
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    -- Collision check — vanishingly unlikely with 32^6 = 1.07B codes,
    -- but cheap to verify.
    exit when not exists(select 1 from public.profiles where invite_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Backfill codes for existing profiles missing one.
update public.profiles
set invite_code = public.gen_invite_code()
where invite_code is null;

-- Make it unique + auto-assign for future inserts.
create unique index if not exists profiles_invite_code_uidx on public.profiles (invite_code);

create or replace function public.set_invite_code_if_missing()
returns trigger
language plpgsql
as $$
begin
  if new.invite_code is null then
    new.invite_code := public.gen_invite_code();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_invite_code on public.profiles;
create trigger profiles_set_invite_code
  before insert on public.profiles
  for each row execute function public.set_invite_code_if_missing();

-- ─────────────────────── Referrals table ───────────────────────

create table if not exists public.referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users (id) on delete cascade,
  referred_id uuid not null references auth.users (id) on delete cascade,
  code        text not null,
  created_at  timestamptz not null default now(),
  unique (referred_id) -- one inviter per account
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;

drop policy if exists "referrals read own" on public.referrals;
create policy "referrals read own"
  on public.referrals
  for select
  to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid());

-- claim_referral: called once by user B at signup time. Looks up the
-- referrer, awards +50 XP to both, records the link. Idempotent for
-- the caller (returns false if they already used a code).
create or replace function public.claim_referral(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid := auth.uid();
  v_referrer    uuid;
  v_code        text := upper(trim(p_code));
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  if v_code is null or length(v_code) <> 6 then
    return false;
  end if;

  select user_id into v_referrer from public.profiles where invite_code = v_code;
  if v_referrer is null or v_referrer = v_user then
    return false;
  end if;

  -- Already claimed?
  if exists(select 1 from public.referrals where referred_id = v_user) then
    return false;
  end if;

  insert into public.referrals (referrer_id, referred_id, code)
  values (v_referrer, v_user, v_code);

  insert into public.xp_transactions (user_id, amount, reason) values
    (v_referrer, 50, 'referral:invited'),
    (v_user,     50, 'referral:joined');

  return true;
end;
$$;

grant execute on function public.claim_referral(text) to authenticated;

-- Returns the caller's invite stats. Used in profile + referral page.
create or replace function public.my_referral_stats()
returns table (
  invite_code     text,
  referred_count  integer,
  xp_from_referrals integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;
  return query
    select
      (select p.invite_code from public.profiles p where p.user_id = v_user),
      (select count(*)::int from public.referrals r where r.referrer_id = v_user),
      coalesce((select sum(amount)::int from public.xp_transactions where user_id = v_user and reason like 'referral:%'), 0);
end;
$$;

grant execute on function public.my_referral_stats() to authenticated;
