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
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now()
);

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
