-- ════════════════════════════════════════════════════════════════════════
-- Cartes évolutives — Phase 1 (moteur + migration)
-- One card per (user, brand, model, BASE COLOUR). Evolves with repeat spots.
--   • uniqueness key gains color_key (dominant body colour, normalised)
--   • levels 1/3/5/10/20  (base · Chasseur · Traqueur · Obsédé · Légende)
--   • XP is DIMINISHING per repeat spot (100/50/25/10 %), not a multiplier
--   • best_photo_url = the FIRST spot's photo (no longer overwritten)
--   • cumulative_xp = per-card display total (forward-only: xp_transactions,
--     i.e. the user leaderboard, is NOT rewritten)
-- Supersedes the engine in 0044-card-progress.sql. Keep in sync with
-- src/lib/cardLevels.ts + src/lib/colorKey.ts.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Dominant base-colour token from the AI's free-text colour ──
-- Mirrors src/lib/colorKey.ts EXACTLY (leading colour word wins).
create or replace function public.color_key(p text)
returns text language plpgsql immutable as $$
declare
  w    text;
  norm text;
begin
  norm := lower(coalesce(p, ''));
  norm := translate(norm,
    'àâäáãéèêëíìîïóòôöõúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn');
  foreach w in array regexp_split_to_array(norm, '[^a-z]+')
  loop
    if w = 'noir'   or w = 'noire' or w = 'noirs' or w = 'black' or w = 'nero' or w = 'nera' then return 'noir'; end if;
    if w = 'blanc'  or w = 'blanche' or w = 'white' or w = 'bianco' or w = 'bianca' or w = 'weiss' then return 'blanc'; end if;
    if w = 'gris'   or w = 'grise' or w = 'grey' or w = 'gray' or w = 'grigio' or w = 'argent' or w = 'argente' or w = 'silver' or w = 'anthracite' or w = 'graphite' or w = 'gunmetal' then return 'gris'; end if;
    if w = 'rouge'  or w = 'red' or w = 'rosso' or w = 'rossa' or w = 'rot' then return 'rouge'; end if;
    if w = 'bleu'   or w = 'bleue' or w = 'blue' or w = 'blu' or w = 'azzurro' or w = 'azur' then return 'bleu'; end if;
    if w = 'vert'   or w = 'verte' or w = 'green' or w = 'verde' then return 'vert'; end if;
    if w = 'jaune'  or w = 'yellow' or w = 'giallo' or w = 'gelb' then return 'jaune'; end if;
    if w = 'orange' or w = 'arancio' or w = 'arancione' or w = 'papaya' then return 'orange'; end if;
    if w = 'violet' or w = 'violette' or w = 'purple' or w = 'viola' or w = 'mauve' or w = 'lila' then return 'violet'; end if;
    if w = 'marron' or w = 'brun' or w = 'brune' or w = 'brown' or w = 'marrone' then return 'marron'; end if;
    if w = 'beige'  or w = 'sable' or w = 'tan' or w = 'creme' or w = 'cream' then return 'beige'; end if;
    if w = 'or'     or w = 'dore' or w = 'doree' or w = 'gold' or w = 'golden' or w = 'oro' then return 'or'; end if;
    if w = 'rose'   or w = 'pink' or w = 'rosa' then return 'rose'; end if;
    if w = 'bronze' or w = 'cuivre' or w = 'copper' then return 'bronze'; end if;
  end loop;
  return 'autre';
end; $$;

-- ── 2. New level thresholds + diminishing XP schedule ──
create or replace function public.card_level_for(p_count int)
returns int language sql immutable as $$
  select case
    when p_count >= 20 then 5
    when p_count >= 10 then 4
    when p_count >= 5  then 3
    when p_count >= 3  then 2
    else 1
  end
$$;

-- Nth valid spot of a card (1-based) → XP factor. 1→100% 2-3→50% 4-10→25% 11+→10%.
create or replace function public.card_spot_xp_factor(p_ordinal int)
returns numeric language sql immutable as $$
  select case
    when p_ordinal <= 1  then 1.0
    when p_ordinal <= 3  then 0.5
    when p_ordinal <= 10 then 0.25
    else 0.1
  end
$$;

-- ── 3. Extend card_progress + widen the primary key to include colour ──
alter table public.card_progress
  add column if not exists color_key    text not null default 'autre',
  add column if not exists color         text,
  add column if not exists first_spot_at timestamptz,
  add column if not exists main_photo_url text,
  add column if not exists cumulative_xp int not null default 0;

alter table public.card_progress drop constraint if exists card_progress_pkey;
alter table public.card_progress
  add constraint card_progress_pkey primary key (user_id, brand_key, model_key, color_key);

-- ── 4. Rewritten award trigger ──
create or replace function public.award_xp_spot()
  returns trigger language plpgsql security definer
  set search_path = public as $$
declare
  r             text := coalesce(new.rarity, 'standard');
  base_xp       int;
  v_today_count int;
  v_yesterday   int;
  day_start     timestamptz := date_trunc('day', new.created_at);
  v_bkey        text := public.card_norm(new.brand);
  v_mkey        text := public.card_norm(new.model);
  v_ckey        text := public.color_key(new.color);
  v_card        public.card_progress%rowtype;
  v_has_card    boolean := false;
  v_prior       int := 0;
  v_ordinal     int;
  v_xp          int;
  v_valid_dup   boolean;
  v_new_count   int;
  v_new_level   int;
begin
  base_xp := case r
    when 'hypercar'    then 250
    when 'supercar'    then 150
    when 'exclusif'    then 90
    when 'performance' then 50
    when 'premium'     then 25
    else                    10
  end;

  -- Diminishing XP by how many times THIS car was already spotted.
  if v_bkey <> '' and v_mkey <> '' then
    select count(*) into v_prior
      from public.spots s
     where s.user_id = new.user_id
       and public.card_norm(s.brand) = v_bkey
       and public.card_norm(s.model) = v_mkey
       and public.color_key(s.color) = v_ckey
       and s.created_at < new.created_at;
  end if;
  v_ordinal := v_prior + 1;
  v_xp := round(base_xp * public.card_spot_xp_factor(v_ordinal))::int;

  insert into public.xp_transactions (user_id, amount, reason)
  values (new.user_id, v_xp, 'spot');

  -- Daily-first (+10) and streak (+5) — unchanged, never scaled.
  select count(*) into v_today_count
    from public.spots
   where user_id = new.user_id
     and created_at >= day_start
     and created_at <= new.created_at;

  if v_today_count = 1 then
    insert into public.xp_transactions (user_id, amount, reason)
    values (new.user_id, 10, 'daily_first');

    select count(*) into v_yesterday
      from public.spots
     where user_id = new.user_id
       and created_at >= day_start - interval '1 day'
       and created_at <  day_start;

    if v_yesterday > 0 then
      insert into public.xp_transactions (user_id, amount, reason)
      values (new.user_id, 5, 'streak');
    end if;
  end if;

  -- ── Card progression ──
  if v_bkey <> '' and v_mkey <> '' then
    select * into v_card from public.card_progress
      where user_id = new.user_id
        and brand_key = v_bkey and model_key = v_mkey and color_key = v_ckey;
    v_has_card := found;

    if not v_has_card then
      insert into public.card_progress (
        user_id, brand_key, model_key, color_key, brand, model, color,
        valid_count, level, first_spot_at, last_spot_at, last_lat, last_lng,
        best_photo_url, cumulative_xp
      ) values (
        new.user_id, v_bkey, v_mkey, v_ckey, new.brand, new.model, new.color,
        1, 1, new.created_at, new.created_at, new.lat, new.lng,
        new.photo_url, v_xp
      )
      on conflict (user_id, brand_key, model_key, color_key) do nothing;
    else
      -- Anti-farm barrier: a valid duplicate requires >12h OR >500m from the
      -- last VALID spot (or unknown last coords). Gates level progression only.
      v_valid_dup :=
        (new.created_at - v_card.last_spot_at > interval '12 hours')
        or v_card.last_lat is null
        or v_card.last_lng is null
        or public.card_distance_m(
             v_card.last_lat, v_card.last_lng, new.lat, new.lng) > 500;

      if v_valid_dup then
        v_new_count := v_card.valid_count + 1;
        v_new_level := public.card_level_for(v_new_count);
        update public.card_progress set
          valid_count   = v_new_count,
          level         = v_new_level,
          last_spot_at  = new.created_at,
          last_lat      = new.lat,
          last_lng      = new.lng,
          cumulative_xp = v_card.cumulative_xp + v_xp,
          -- best_photo_url stays the FIRST photo; user picks another via main_photo_url.
          title = case
                    when v_new_level >= 5 and v_card.title is null
                      then 'Maître de la ' || new.model
                    else v_card.title
                  end,
          updated_at    = now()
        where user_id = new.user_id
          and brand_key = v_bkey and model_key = v_mkey and color_key = v_ckey;
      else
        -- Farm duplicate: still earns its (small) XP, no level progression.
        update public.card_progress set
          cumulative_xp = v_card.cumulative_xp + v_xp,
          updated_at    = now()
        where user_id = new.user_id
          and brand_key = v_bkey and model_key = v_mkey and color_key = v_ckey;
      end if;
    end if;
  end if;

  return new;
end; $$;

-- ── 5. Rebuild card_progress from scratch under the new key ──
-- valid_count counts all history (barrier applies only to FUTURE spots, as the
-- 0044 backfill did). cumulative_xp is recomputed under the diminishing
-- schedule; xp_transactions is intentionally left untouched (forward-only).
delete from public.card_progress;
insert into public.card_progress
  (user_id, brand_key, model_key, color_key, brand, model, color,
   valid_count, level, first_spot_at, last_spot_at, last_lat, last_lng,
   best_photo_url, main_photo_url, cumulative_xp, title, updated_at)
with ranked as (
  select
    s.*,
    public.card_norm(s.brand) bkey,
    public.card_norm(s.model) mkey,
    public.color_key(s.color)  ckey,
    row_number() over (
      partition by s.user_id, public.card_norm(s.brand),
                   public.card_norm(s.model), public.color_key(s.color)
      order by s.created_at, s.id) ord,
    case lower(coalesce(s.rarity, 'standard'))
      when 'hypercar' then 250 when 'supercar' then 150 when 'exclusif' then 90
      when 'performance' then 50 when 'premium' then 25 else 10 end base_xp
  from public.spots s
  where coalesce(public.card_norm(s.brand), '') <> ''
    and coalesce(public.card_norm(s.model), '') <> ''
),
scored as (
  select *, round(base_xp * public.card_spot_xp_factor(ord::int))::int spot_xp
  from ranked
)
select
  user_id, bkey, mkey, ckey,
  (array_agg(brand order by created_at, id))[1],
  (array_agg(model order by created_at, id))[1],
  (array_agg(color order by created_at, id))[1],
  count(*)::int,
  public.card_level_for(count(*)::int),
  min(created_at),
  max(created_at),
  (array_agg(lat  order by created_at desc, id desc))[1],
  (array_agg(lng  order by created_at desc, id desc))[1],
  (array_agg(photo_url order by created_at, id))[1],
  null,
  sum(spot_xp)::int,
  case when public.card_level_for(count(*)::int) >= 5
       then 'Maître de la ' || (array_agg(model order by created_at, id))[1]
       else null end,
  now()
from scored
group by user_id, bkey, mkey, ckey;
