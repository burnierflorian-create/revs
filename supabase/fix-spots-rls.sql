-- REVS — full RLS repair. Fixes "new row violates row-level security
-- policy" on spots and audits every user-facing table. Idempotent:
-- enables RLS, drops every known prior policy name, recreates the
-- correct set. Safe to run repeatedly.

-- ============================================================ spots
alter table public.spots enable row level security;

drop policy if exists "spots are readable by authenticated users" on public.spots;
drop policy if exists "users insert their own spots"              on public.spots;
drop policy if exists "users modify their own spots"              on public.spots;
drop policy if exists "users delete their own spots"              on public.spots;
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

-- ======================================================= spot_likes
alter table public.spot_likes enable row level security;

drop policy if exists "spot likes are readable by authenticated users" on public.spot_likes;
drop policy if exists "users like as themselves"                       on public.spot_likes;
drop policy if exists "users remove their own like"                    on public.spot_likes;
drop policy if exists "spot_likes public read"                         on public.spot_likes;
drop policy if exists "spot_likes insert own"                          on public.spot_likes;
drop policy if exists "spot_likes delete own"                          on public.spot_likes;

-- Public read so like counts show even for logged-out viewers.
create policy "spot_likes public read"
  on public.spot_likes for select using (true);

create policy "spot_likes insert own"
  on public.spot_likes for insert to authenticated
  with check (auth.uid() = user_id);

create policy "spot_likes delete own"
  on public.spot_likes for delete to authenticated
  using (auth.uid() = user_id);

-- =========================================================== events
alter table public.events enable row level security;

drop policy if exists "events are readable by authenticated users" on public.events;
drop policy if exists "users insert their own events"              on public.events;
drop policy if exists "users modify their own events"              on public.events;
drop policy if exists "users delete their own events"              on public.events;
drop policy if exists "events public read"                         on public.events;
drop policy if exists "events insert own"                          on public.events;
drop policy if exists "events insert organizer"                    on public.events;
drop policy if exists "events update own"                          on public.events;
drop policy if exists "events delete own"                          on public.events;

create policy "events public read"
  on public.events for select using (true);

-- Event creation is gated to organizers/admins (see 0002-organizer.sql).
-- Keep this in sync so re-running this file never re-opens it.
create policy "events insert organizer"
  on public.events for insert to authenticated
  with check (
    auth.uid() = organizer_id
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('organizer', 'admin')
    )
  );

create policy "events update own"
  on public.events for update to authenticated
  using (auth.uid() = organizer_id)
  with check (auth.uid() = organizer_id);

create policy "events delete own"
  on public.events for delete to authenticated
  using (auth.uid() = organizer_id);

-- ========================================================= profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles readable by everyone" on public.profiles;
drop policy if exists "profiles readable"             on public.profiles;
drop policy if exists "users insert own profile"      on public.profiles;
drop policy if exists "users update own profile"      on public.profiles;

create policy "profiles readable"
  on public.profiles for select
  using (is_public or auth.uid() = user_id);

create policy "users insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================= news
-- Public content. Writes happen only via the cron's service-role key
-- (bypasses RLS), so there is intentionally no write policy.
alter table public.news enable row level security;

drop policy if exists "news readable by authenticated users" on public.news;
drop policy if exists "news readable by everyone"            on public.news;

create policy "news readable by everyone"
  on public.news for select using (true);

-- ================================================== xp_transactions
-- Readable by all (leaderboard). Writes only via SECURITY DEFINER
-- trigger functions, so no write policy is granted.
alter table public.xp_transactions enable row level security;

drop policy if exists "xp readable" on public.xp_transactions;

create policy "xp readable"
  on public.xp_transactions for select using (true);
