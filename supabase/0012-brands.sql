-- Brand catalogue : follows + cached descriptions.
-- Apply: node scripts/apply-rls.mjs supabase/0012-brands.sql
--
-- `brand` everywhere is the catalogue slug (kebab-case, lowercase) — see
-- src/lib/brands.ts. It is a free `text` column, not a FK, so the
-- catalogue can evolve without DB migrations.

create table if not exists public.brand_follows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  brand      text not null,
  created_at timestamptz not null default now(),
  unique (user_id, brand)
);

create index if not exists brand_follows_brand_idx
  on public.brand_follows (brand);
create index if not exists brand_follows_user_idx
  on public.brand_follows (user_id);

alter table public.brand_follows enable row level security;

drop policy if exists "brand follows own read"   on public.brand_follows;
drop policy if exists "brand follows own insert" on public.brand_follows;
drop policy if exists "brand follows own delete" on public.brand_follows;
drop policy if exists "brand follows count read" on public.brand_follows;

-- Per-user CRUD of own rows.
create policy "brand follows own read"
  on public.brand_follows for select to authenticated
  using (auth.uid() = user_id);
create policy "brand follows own insert"
  on public.brand_follows for insert to authenticated
  with check (auth.uid() = user_id);
create policy "brand follows own delete"
  on public.brand_follows for delete to authenticated
  using (auth.uid() = user_id);

-- The follower count on a brand page must be visible to everyone (incl.
-- non-followers). We expose JUST the brand column publicly via an RPC
-- with security definer, since RLS would otherwise hide other users'
-- rows.
create or replace function public.brand_follower_count(p_brand text)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.brand_follows where brand = p_brand;
$$;
grant execute on function public.brand_follower_count(text) to anon, authenticated;

-- Brand description cache. Populated lazily by /api/brand-description
-- on first visit, then reused for every subsequent visitor.
create table if not exists public.brand_descriptions (
  brand        text primary key,
  description  text not null,
  generated_at timestamptz not null default now()
);

alter table public.brand_descriptions enable row level security;

drop policy if exists "brand desc public read" on public.brand_descriptions;

-- Read is public (info shown to all visitors). Writes happen via the
-- service-role from the API only — no policy needed for write.
create policy "brand desc public read"
  on public.brand_descriptions for select to anon, authenticated
  using (true);

notify pgrst, 'reload schema';
