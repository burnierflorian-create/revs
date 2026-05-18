-- Price-based XP. Adds spots.estimated_price (€, integer) and makes
-- the spot-insert XP trigger scale with it.
-- Apply: node scripts/apply-rls.mjs supabase/0006-spot-price-xp.sql

alter table public.spots
  add column if not exists estimated_price integer;

create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  p integer := coalesce(new.estimated_price, 0);
  amt integer;
begin
  if    p >= 1000000 then amt := 100;  -- légendaire
  elsif p >=  500000 then amt := 80;   -- ultra rare
  elsif p >=  200000 then amt := 40;   -- hypercar
  elsif p >=   80000 then amt := 20;   -- supercar
  elsif p >=   30000 then amt := 10;   -- premium
  else                    amt := 5;    -- ordinaire / prix inconnu
  end if;
  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, amt, 'spot');
  return new;
end; $$;

notify pgrst, 'reload schema';
