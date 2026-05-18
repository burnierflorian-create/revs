-- 1) Merge the "classic/Classics" category into "other" (= "Autre").
update public.spots
set category = 'other'
where category in ('classic', 'classics', 'Classic', 'Classics');

-- 2) Daily spot counter (free-tier limit = 5/day). The count is
-- maintained server-side by a SECURITY DEFINER trigger; clients only
-- read their own row to gate the UI.
create table if not exists public.spot_count_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  date    date not null default current_date,
  count   integer not null default 0,
  primary key (user_id, date)
);

alter table public.spot_count_daily enable row level security;

drop policy if exists "spot count own read" on public.spot_count_daily;
create policy "spot count own read"
  on public.spot_count_daily for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.bump_spot_count()
  returns trigger language plpgsql security definer
  set search_path = public as $$
begin
  insert into public.spot_count_daily (user_id, date, count)
  values (new.user_id, current_date, 1)
  on conflict (user_id, date)
  do update set count = public.spot_count_daily.count + 1;
  return new;
end; $$;

drop trigger if exists trg_bump_spot_count on public.spots;
create trigger trg_bump_spot_count after insert on public.spots
  for each row execute function public.bump_spot_count();

notify pgrst, 'reload schema';
