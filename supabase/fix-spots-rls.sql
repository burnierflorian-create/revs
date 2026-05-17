-- Fix: "new row violates row-level security policy" on public.spots
--
-- Idempotently rebuilds the spots RLS policies:
--   * SELECT  — public (anyone, the map shows everyone's spots)
--   * INSERT  — authenticated, only rows where auth.uid() = user_id
--   * UPDATE  — authenticated, only own rows (check on the new row too)
--   * DELETE  — authenticated, only own rows
--
-- Safe to run repeatedly.

alter table public.spots enable row level security;

-- Drop every known prior policy name (schema.sql names + canonical ones).
drop policy if exists "spots are readable by authenticated users" on public.spots;
drop policy if exists "users insert their own spots"              on public.spots;
drop policy if exists "users modify their own spots"              on public.spots;
drop policy if exists "users delete their own spots"              on public.spots;
drop policy if exists "spots public read"                         on public.spots;
drop policy if exists "spots insert own"                          on public.spots;
drop policy if exists "spots update own"                          on public.spots;
drop policy if exists "spots delete own"                          on public.spots;

create policy "spots public read"
  on public.spots for select
  using (true);

create policy "spots insert own"
  on public.spots for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "spots update own"
  on public.spots for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "spots delete own"
  on public.spots for delete
  to authenticated
  using (auth.uid() = user_id);
