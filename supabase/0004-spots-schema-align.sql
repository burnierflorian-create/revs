-- ROOT CAUSE of "Échec de la publication": the live `spots` table was
-- hand-made with different column names than the app/schema contract
-- (car_brand/car_model/car_year/car_color/car_category/latitude/
-- longitude, and no expires_at). Every insert sent brand/model/lat/lng
-- → "column not found" → generic failure. This idempotently renames
-- the columns to what the code expects and adds the missing ones.
-- Apply via: node scripts/apply-rls.mjs supabase/0004-spots-schema-align.sql

do $$
declare r record;
begin
  for r in
    select old, new from (values
      ('car_brand', 'brand'),
      ('car_model', 'model'),
      ('car_year', 'year'),
      ('car_color', 'color'),
      ('car_category', 'category'),
      ('latitude', 'lat'),
      ('longitude', 'lng')
    ) as t(old, new)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='spots'
        and column_name = r.old
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='spots'
        and column_name = r.new
    ) then
      execute format(
        'alter table public.spots rename column %I to %I', r.old, r.new
      );
    end if;
  end loop;
end $$;

alter table public.spots
  add column if not exists expires_at timestamptz not null
  default (now() + interval '1 hour');

create index if not exists spots_created_at_idx
  on public.spots (created_at desc);
create index if not exists spots_expires_at_idx
  on public.spots (expires_at);

-- Make PostgREST pick up the renamed columns immediately.
notify pgrst, 'reload schema';
