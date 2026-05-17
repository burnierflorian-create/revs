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
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now()
);

-- For databases created before the confidence column existed.
alter table public.spots add column if not exists confidence integer;

create index if not exists spots_created_at_idx on public.spots (created_at desc);

-- 2. Row Level Security ------------------------------------------------------
alter table public.spots enable row level security;

-- Any authenticated user can read all spots (the map shows everyone's).
create policy "spots are readable by authenticated users"
  on public.spots for select
  to authenticated
  using (true);

-- A user can only insert spots attributed to themselves.
create policy "users insert their own spots"
  on public.spots for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user can update/delete only their own spots.
create policy "users modify their own spots"
  on public.spots for update
  to authenticated
  using (auth.uid() = user_id);

create policy "users delete their own spots"
  on public.spots for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3. Realtime ----------------------------------------------------------------
alter publication supabase_realtime add table public.spots;

-- 4. Storage bucket "spots" --------------------------------------------------
insert into storage.buckets (id, name, public)
values ('spots', 'spots', true)
on conflict (id) do nothing;

-- Public read of spot photos.
create policy "public read spot photos"
  on storage.objects for select
  using (bucket_id = 'spots');

-- Authenticated users can upload only into their own {userId}/ folder.
create policy "users upload own spot photos"
  on storage.objects for insert
  to authenticated
  with check (
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

alter table public.news enable row level security;

-- Readable by the app (authenticated). Inserts are done only by the cron
-- with the service-role key, which bypasses RLS — no write policy needed.
create policy "news readable by authenticated users"
  on public.news for select
  to authenticated
  using (true);
