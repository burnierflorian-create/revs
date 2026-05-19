-- Social layer: follows + comments. Idempotent.
-- Apply: node scripts/apply-rls.mjs supabase/0008-social.sql

-- ============================================================ follows
create table if not exists public.followers (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists followers_following_idx
  on public.followers (following_id);

alter table public.followers enable row level security;

drop policy if exists "followers public read" on public.followers;
drop policy if exists "follow as self"        on public.followers;
drop policy if exists "unfollow as self"      on public.followers;

create policy "followers public read"
  on public.followers for select using (true);

create policy "follow as self"
  on public.followers for insert to authenticated
  with check (auth.uid() = follower_id);

create policy "unfollow as self"
  on public.followers for delete to authenticated
  using (auth.uid() = follower_id);

-- ========================================================== comments
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  spot_id    uuid not null references public.spots (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  content    text not null
             check (char_length(content) between 1 and 280),
  created_at timestamptz not null default now()
);

create index if not exists comments_spot_idx
  on public.comments (spot_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments public read" on public.comments;
drop policy if exists "comment as self"      on public.comments;
drop policy if exists "delete own comment"   on public.comments;

create policy "comments public read"
  on public.comments for select using (true);

create policy "comment as self"
  on public.comments for insert to authenticated
  with check (auth.uid() = user_id);

create policy "delete own comment"
  on public.comments for delete to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
