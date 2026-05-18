-- Run this once in the Supabase SQL editor (Project → SQL → New query).
-- Creates the spots table, RLS policies, realtime, and the storage bucket.

-- 1. Table -------------------------------------------------------------------
create table if not exists public.spots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  brand       text not null,
  model       text not null,
  year        integer,
  color       text,
  category    text not null default 'other',
  description text,
  photo_url   text,
  confidence  integer,
  estimated_price integer,
  lat         double precision not null,
  lng         double precision not null,
  expires_at  timestamptz not null default (now() + interval '1 hour'),
  created_at  timestamptz not null default now()
);

-- For databases created before these columns existed.
alter table public.spots add column if not exists confidence integer;
alter table public.spots add column if not exists estimated_price integer;
alter table public.spots
  add column if not exists expires_at timestamptz not null
  default (now() + interval '1 hour');

create index if not exists spots_created_at_idx on public.spots (created_at desc);
create index if not exists spots_expires_at_idx on public.spots (expires_at);

-- Extend a spot's life by 1h (a like or a view "keeps it alive").
-- SECURITY DEFINER so any authenticated viewer can extend a spot they
-- don't own, without a broad UPDATE policy. (The like-trigger lives
-- after the spot_likes table, in section 7.)
create or replace function public.touch_spot(p_spot_id uuid)
  returns void language sql security definer set search_path = public as $$
  update public.spots
  set expires_at = now() + interval '1 hour'
  where id = p_spot_id;
$$;

-- 2. Row Level Security ------------------------------------------------------
alter table public.spots enable row level security;

-- Idempotent: drop every prior/legacy name, then recreate the
-- canonical set. SELECT is public; writes are authenticated + own row.
drop policy if exists "spots are readable by authenticated users" on public.spots;
drop policy if exists "users insert their own spots"              on public.spots;
drop policy if exists "users modify their own spots"              on public.spots;
drop policy if exists "users delete their own spots"              on public.spots;
drop policy if exists "Spots visibles par tous"                   on public.spots;
drop policy if exists "Users can read spots"                      on public.spots;
drop policy if exists "Users can insert spots"                    on public.spots;
drop policy if exists "Utilisateur peut créer ses spots"          on public.spots;
drop policy if exists "Users can update own spots"                on public.spots;
drop policy if exists "Utilisateur peut supprimer ses spots"      on public.spots;
drop policy if exists "spots public read"                         on public.spots;
drop policy if exists "spots insert own"                          on public.spots;
drop policy if exists "spots update own"                          on public.spots;
drop policy if exists "spots delete own"                          on public.spots;

create policy "spots public read"
  on public.spots for select using (true);

create policy "spots insert own"
  on public.spots for insert to authenticated
  with check (auth.uid() = user_id);

create policy "spots update own"
  on public.spots for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "spots delete own"
  on public.spots for delete to authenticated
  using (auth.uid() = user_id);

-- 3. Realtime ----------------------------------------------------------------
alter publication supabase_realtime add table public.spots;

-- 4. Storage bucket "spots" --------------------------------------------------
insert into storage.buckets (id, name, public)
values ('spots', 'spots', true)
on conflict (id) do nothing;

-- Idempotent storage policies for the spots bucket. (Their ABSENCE on
-- the live DB was the root cause of "new row violates RLS" on posting
-- a spot — the photo upload was denied before the table insert.)
drop policy if exists "public read spot photos"     on storage.objects;
drop policy if exists "users upload own spot photos" on storage.objects;
drop policy if exists "users update own spot photos" on storage.objects;

create policy "public read spot photos"
  on storage.objects for select
  using (bucket_id = 'spots');

create policy "users upload own spot photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'spots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update own spot photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'spots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Events ------------------------------------------------------------------
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  type         text not null,
  starts_at    timestamptz not null,
  location     text not null,
  description  text,
  created_at   timestamptz not null default now()
);

create index if not exists events_starts_at_idx on public.events (starts_at asc);

alter table public.events enable row level security;

create policy "events are readable by authenticated users"
  on public.events for select
  to authenticated
  using (true);

create policy "users insert their own events"
  on public.events for insert
  to authenticated
  with check (auth.uid() = organizer_id);

create policy "users modify their own events"
  on public.events for update
  to authenticated
  using (auth.uid() = organizer_id);

create policy "users delete their own events"
  on public.events for delete
  to authenticated
  using (auth.uid() = organizer_id);

-- 6. Subscriptions (Stripe) --------------------------------------------------
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users (id) on delete cascade,
  stripe_customer_id text,
  plan               text,
  status             text,
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- A user can read their own subscription.
create policy "users read their own subscription"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

-- Writes are performed only by the Stripe webhook using the Supabase
-- service-role key, which bypasses RLS — so no insert/update policy is
-- granted to normal authenticated clients on purpose.

-- 7. Spot likes --------------------------------------------------------------
create table if not exists public.spot_likes (
  id         uuid primary key default gen_random_uuid(),
  spot_id    uuid not null references public.spots (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (spot_id, user_id)
);

create index if not exists spot_likes_spot_id_idx on public.spot_likes (spot_id);

alter table public.spot_likes enable row level security;

-- Anyone authenticated can read likes (needed for counts).
create policy "spot likes are readable by authenticated users"
  on public.spot_likes for select
  to authenticated
  using (true);

-- A user can only create a like attributed to themselves.
create policy "users like as themselves"
  on public.spot_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user can only remove their own like.
create policy "users remove their own like"
  on public.spot_likes for delete
  to authenticated
  using (auth.uid() = user_id);

alter publication supabase_realtime add table public.spot_likes;

-- A like keeps the spot alive for another hour.
create or replace function public.extend_spot_on_like()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.spots
  set expires_at = now() + interval '1 hour'
  where id = new.spot_id;
  return new;
end; $$;

drop trigger if exists trg_extend_spot_on_like on public.spot_likes;
create trigger trg_extend_spot_on_like after insert on public.spot_likes
  for each row execute function public.extend_spot_on_like();

-- 8. News (filled by the Vercel cron via the service-role key) ---------------
create table if not exists public.news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  summary      text,
  source       text,
  category     text not null default 'Auto',
  url          text not null unique,
  image_url    text,
  published_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists news_published_at_idx on public.news (published_at desc);

-- Allowed categories must match the Actu filters (F1 / Supercar /
-- Hypercar / Events). Drop any prior restrictive check, then re-add the
-- current set so re-running this file upgrades existing databases.
alter table public.news drop constraint if exists news_category_check;
alter table public.news
  add constraint news_category_check
  check (category in ('F1', 'Supercar', 'Hypercar', 'Events', 'Auto'));

alter table public.news enable row level security;

-- News is public content: readable by everyone (anon + authenticated).
-- Inserts are done only by the cron with the service-role key, which
-- bypasses RLS — no write policy needed.
drop policy if exists "news readable by authenticated users" on public.news;
drop policy if exists "news readable by everyone" on public.news;
create policy "news readable by everyone"
  on public.news for select
  using (true);

-- 9. XP / gamification -------------------------------------------------------
create table if not exists public.xp_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  created_at timestamptz not null default now()
);

create index if not exists xp_user_idx on public.xp_transactions (user_id);

alter table public.xp_transactions enable row level security;

-- Readable by everyone (the leaderboard aggregates across users). Writes
-- happen only via the SECURITY DEFINER triggers below, so no write policy.
drop policy if exists "xp readable" on public.xp_transactions;
create policy "xp readable" on public.xp_transactions for select using (true);

-- Award functions run as definer so they can write xp_transactions
-- regardless of who triggered the row (e.g. a like on someone else's spot).
-- XP scales with the spotted car's estimated price (see
-- supabase/0006-spot-price-xp.sql). Unknown price → ordinaire (+5).
create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  p integer := coalesce(new.estimated_price, 0);
  amt integer;
begin
  if    p >= 1000000 then amt := 100;
  elsif p >=  500000 then amt := 80;
  elsif p >=  200000 then amt := 40;
  elsif p >=   80000 then amt := 20;
  elsif p >=   30000 then amt := 10;
  else                    amt := 5;
  end if;
  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, amt, 'spot');
  return new;
end; $$;

create or replace function public.award_xp_event()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.xp_transactions (user_id, amount, reason)
  values (new.organizer_id, 20, 'event');
  return new;
end; $$;

create or replace function public.award_xp_like()
  returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from public.spots where id = new.spot_id;
  if owner is not null then
    insert into public.xp_transactions (user_id, amount, reason)
    values (owner, 5, 'like');
  end if;
  return new;
end; $$;

-- Unlike reverses the +5 so XP can't be farmed by like/unlike loops.
create or replace function public.revoke_xp_like()
  returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from public.spots where id = old.spot_id;
  if owner is not null then
    insert into public.xp_transactions (user_id, amount, reason)
    values (owner, -5, 'like_removed');
  end if;
  return old;
end; $$;

drop trigger if exists trg_xp_spot on public.spots;
create trigger trg_xp_spot after insert on public.spots
  for each row execute function public.award_xp_spot();

drop trigger if exists trg_xp_event on public.events;
create trigger trg_xp_event after insert on public.events
  for each row execute function public.award_xp_event();

drop trigger if exists trg_xp_like on public.spot_likes;
create trigger trg_xp_like after insert on public.spot_likes
  for each row execute function public.award_xp_like();

drop trigger if exists trg_xp_unlike on public.spot_likes;
create trigger trg_xp_unlike after delete on public.spot_likes
  for each row execute function public.revoke_xp_like();

-- Current user's XP total.
create or replace function public.my_xp()
  returns integer language sql security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int
  from public.xp_transactions
  where user_id = auth.uid();
$$;

-- Leaderboard aggregate (exposes totals, not individual transactions).
create or replace function public.top_spotters(limit_count int default 10)
  returns table (user_id uuid, xp int)
  language sql security definer set search_path = public as $$
  select user_id, coalesce(sum(amount), 0)::int as xp
  from public.xp_transactions
  group by user_id
  order by xp desc
  limit limit_count;
$$;

-- Backfill: reconcile each user's XP to the rule-based total for all
-- EXISTING data (spots ×10, events ×20, likes received ×5). Inserts a
-- single delta per user, guarded by a per-user 'reconcile' row so it is
-- idempotent regardless of whether triggers already fired.
insert into public.xp_transactions (user_id, amount, reason)
select u.user_id, u.target - coalesce(c.cur, 0), 'reconcile'
from (
  select uid as user_id, sum(pts) as target from (
    select user_id as uid, count(*) * 10 as pts
      from public.spots group by user_id
    union all
    select organizer_id, count(*) * 20
      from public.events group by organizer_id
    union all
    select s.user_id, count(*) * 5
      from public.spot_likes l
      join public.spots s on s.id = l.spot_id
      group by s.user_id
  ) parts group by uid
) u
left join (
  select user_id, sum(amount) as cur
    from public.xp_transactions group by user_id
) c on c.user_id = u.user_id
where u.target - coalesce(c.cur, 0) <> 0
  and not exists (
    select 1 from public.xp_transactions x
    where x.user_id = u.user_id and x.reason = 'reconcile'
  );

-- 10. Profiles --------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  pseudo     text,
  ville      text,
  avatar     text,
  is_public  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- For databases created before is_public existed.
alter table public.profiles
  add column if not exists is_public boolean not null default true;

alter table public.profiles enable row level security;

-- Readable when public, or always by the owner (privacy toggle).
drop policy if exists "profiles readable by everyone" on public.profiles;
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable"
  on public.profiles for select
  using (is_public or auth.uid() = user_id);

-- A user can create and edit only their own profile. WITH CHECK on
-- UPDATE is required so upsert's conflict-update path passes RLS.
drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 11. Avatars storage bucket -------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload own avatar" on storage.objects;
create policy "users upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own avatar" on storage.objects;
create policy "users update own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
