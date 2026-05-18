-- The live `events` table was hand-made with different column names
-- than the app (event_type/start_datetime/location_name/latitude/
-- longitude, the last two NOT NULL) → event creation was silently
-- broken (same class of bug as spots). Idempotently rename to the
-- code contract and relax lat/lng (events may have no coords).
-- Apply: node scripts/apply-rls.mjs supabase/0005-events-schema-align.sql

do $$
declare r record;
begin
  for r in
    select old, new from (values
      ('event_type', 'type'),
      ('start_datetime', 'starts_at'),
      ('location_name', 'location'),
      ('latitude', 'lat'),
      ('longitude', 'lng')
    ) as t(old, new)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='events'
        and column_name = r.old
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='events'
        and column_name = r.new
    ) then
      execute format(
        'alter table public.events rename column %I to %I', r.old, r.new
      );
    end if;
  end loop;
end $$;

alter table public.events alter column lat drop not null;
alter table public.events alter column lng drop not null;

create index if not exists events_starts_at_idx
  on public.events (starts_at asc);

notify pgrst, 'reload schema';
