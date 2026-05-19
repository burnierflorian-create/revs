-- Web Push: subscriptions + per-type preferences. Idempotent.
-- Apply: node scripts/apply-rls.mjs supabase/0009-push.sql

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subs_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push subs own read"   on public.push_subscriptions;
drop policy if exists "push subs own insert" on public.push_subscriptions;
drop policy if exists "push subs own delete" on public.push_subscriptions;

create policy "push subs own read"
  on public.push_subscriptions for select to authenticated
  using (auth.uid() = user_id);
create policy "push subs own insert"
  on public.push_subscriptions for insert to authenticated
  with check (auth.uid() = user_id);
create policy "push subs own delete"
  on public.push_subscriptions for delete to authenticated
  using (auth.uid() = user_id);

create table if not exists public.notification_prefs (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  likes     boolean not null default true,
  comments  boolean not null default true,
  followers boolean not null default true,
  nearby    boolean not null default true,
  streak    boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists "notif prefs own read"   on public.notification_prefs;
drop policy if exists "notif prefs own write"  on public.notification_prefs;
drop policy if exists "notif prefs own update" on public.notification_prefs;

create policy "notif prefs own read"
  on public.notification_prefs for select to authenticated
  using (auth.uid() = user_id);
create policy "notif prefs own write"
  on public.notification_prefs for insert to authenticated
  with check (auth.uid() = user_id);
create policy "notif prefs own update"
  on public.notification_prefs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
