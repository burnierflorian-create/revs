-- REVS — organizer role + event-creation gating. Idempotent; safe to
-- run repeatedly via: node scripts/apply-rls.mjs supabase/0002-organizer.sql

-- 1. profiles.role ----------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'organizer', 'admin'));

-- 2. organizer_requests ----------------------------------------------
create table if not exists public.organizer_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  pseudo     text,
  ville      text,
  raison     text,
  created_at timestamptz not null default now()
);

create index if not exists organizer_requests_user_idx
  on public.organizer_requests (user_id);

alter table public.organizer_requests enable row level security;

drop policy if exists "org req insert own"  on public.organizer_requests;
drop policy if exists "org req select own"  on public.organizer_requests;

-- A user can file and read only their own request. Admin review is
-- done with the service-role key (bypasses RLS) / the dashboard.
create policy "org req insert own"
  on public.organizer_requests for insert to authenticated
  with check (auth.uid() = user_id);

create policy "org req select own"
  on public.organizer_requests for select to authenticated
  using (auth.uid() = user_id);

-- 3. events: only organizers/admins may create -----------------------
alter table public.events enable row level security;

drop policy if exists "events insert own"              on public.events;
drop policy if exists "users insert their own events"  on public.events;
drop policy if exists "events insert organizer"        on public.events;

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
