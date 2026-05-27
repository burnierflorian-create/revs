-- ─────────────────────── Spot rarity + new XP formula ───────────────────────
-- XP is now `base(price) × multiplier(rarity)` rounded to the nearest
-- integer. The base ladder stays close to the old prices-only system
-- but tops out at 75 (instead of 100) so the multiplier has headroom
-- to push truly exceptional spots toward 300 XP. Rarity is filled at
-- insert time by the AI pipeline (see api/identify-car.js).

alter table public.spots
  add column if not exists rarity text
    check (rarity in ('commun', 'rare', 'ultra_rare', 'unique'));

alter table public.spots
  add column if not exists production integer;

create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  p     integer := coalesce(new.estimated_price, 0);
  r     text    := coalesce(new.rarity, 'commun');
  base  integer;
  mult  numeric;
begin
  -- Base from price tier
  if    p >= 1000000 then base := 75;
  elsif p >=  500000 then base := 55;
  elsif p >=  200000 then base := 35;
  elsif p >=   80000 then base := 20;
  elsif p >=   30000 then base := 10;
  else                    base := 5;
  end if;

  -- Rarity multiplier
  if    r = 'unique'     then mult := 4.0;
  elsif r = 'ultra_rare' then mult := 2.5;
  elsif r = 'rare'       then mult := 1.5;
  else                        mult := 1.0;
  end if;

  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, round(base * mult)::int, 'spot');
  return new;
end; $$;

notify pgrst, 'reload schema';
