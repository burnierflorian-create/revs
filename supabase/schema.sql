-- ─────────────────────── Schéma REVS — public ───────────────────────
--
-- GÉNÉRÉ AUTOMATIQUEMENT depuis la base de production le 2026-09-28.
-- Ne pas éditer à la main : régénérer avec le script de dump.
--
-- Ce fichier est un INSTANTANÉ documentaire, pas une migration. La source
-- de vérité reste la suite numérotée supabase/0001..00NN, qui seule doit
-- être appliquée. L'ancienne version de ce fichier avait dérivé — elle
-- décrivait 15 colonnes sur `spots` quand la production en comptait 23.
--
-- Reconstruit depuis pg_catalog (pg_get_constraintdef, pg_get_indexdef,
-- pg_get_functiondef, pg_get_triggerdef) : le DDL vient de PostgreSQL
-- lui-même, il n'est pas réécrit à la main.

-- ═══════════════════════════ TABLES ═══════════════════════════

create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null,
  count integer not null default 0,
  last_at timestamptz,
  endpoint text not null default 'identify-car'::text,
  constraint ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint ai_usage_pkey PRIMARY KEY (user_id, day, endpoint)
);

create table if not exists public.api_abuse_attempts (
  id bigint not null default nextval('api_abuse_attempts_id_seq'::regclass),
  endpoint text not null,
  ip_hash text,
  user_agent text,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint api_abuse_attempts_pkey PRIMARY KEY (id)
);

create table if not exists public.brand_descriptions (
  brand text not null,
  description text not null,
  generated_at timestamptz not null default now(),
  constraint brand_descriptions_pkey PRIMARY KEY (brand)
);

create table if not exists public.brand_follows (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  brand text not null,
  created_at timestamptz not null default now(),
  constraint brand_follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint brand_follows_pkey PRIMARY KEY (id),
  constraint brand_follows_user_id_brand_key UNIQUE (user_id, brand)
);

create table if not exists public.car_catalog (
  slug text not null,
  brand text not null,
  model text not null,
  market_value integer,
  rarity text not null default 'standard'::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint car_catalog_pkey PRIMARY KEY (slug)
);

create table if not exists public.car_info_cache (
  slug text not null,
  brand text not null,
  model text not null,
  year integer,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint car_info_cache_pkey PRIMARY KEY (slug)
);

create table if not exists public.car_renders (
  id uuid not null default gen_random_uuid(),
  make text not null,
  model text not null,
  render_url text not null,
  created_at timestamptz not null default now(),
  constraint car_renders_pkey PRIMARY KEY (id),
  constraint car_renders_make_model_key UNIQUE (make, model)
);

create table if not exists public.car_specs (
  slug text not null,
  brand text not null,
  model text not null,
  year integer,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  constraint car_specs_pkey PRIMARY KEY (slug)
);

create table if not exists public.card_progress (
  user_id uuid not null,
  brand_key text not null,
  model_key text not null,
  brand text not null,
  model text not null,
  valid_count integer not null default 1,
  level integer not null default 1,
  last_spot_at timestamptz not null default now(),
  last_lat double precision,
  last_lng double precision,
  best_photo_url text,
  title text,
  updated_at timestamptz not null default now(),
  color_key text not null default 'autre'::text,
  color text,
  first_spot_at timestamptz,
  main_photo_url text,
  cumulative_xp integer not null default 0,
  constraint card_progress_level_check CHECK (((level >= 1) AND (level <= 5))),
  constraint card_progress_valid_count_check CHECK ((valid_count > 0)),
  constraint card_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint card_progress_pkey PRIMARY KEY (user_id, brand_key, model_key, color_key)
);

create table if not exists public.challenges (
  id uuid not null default gen_random_uuid(),
  title text not null,
  description text not null,
  type text not null,
  target_value integer not null default 1,
  target_brand text,
  target_category text,
  xp_reward integer not null default 30,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint challenges_type_check CHECK ((type = ANY (ARRAY['spot_brand'::text, 'spot_count'::text, 'spot_category'::text]))),
  constraint challenges_pkey PRIMARY KEY (id)
);

create table if not exists public.collection_progress (
  user_id uuid not null,
  collection_id text not null,
  completed_at timestamptz not null default now(),
  xp_awarded integer not null,
  constraint collection_progress_xp_awarded_check CHECK ((xp_awarded > 0)),
  constraint collection_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint collection_progress_pkey PRIMARY KEY (user_id, collection_id)
);

create table if not exists public.comments (
  id uuid not null default gen_random_uuid(),
  spot_id uuid not null,
  user_id uuid not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint comments_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 280))),
  constraint comments_spot_id_fkey FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE,
  constraint comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint comments_pkey PRIMARY KEY (id)
);

create table if not exists public.daily_challenges (
  user_id uuid not null,
  date date not null,
  objective text not null,
  xp_reward integer not null default 30,
  completed_at timestamptz,
  generated_at timestamptz not null default now(),
  constraint daily_challenges_xp_reward_check CHECK (((xp_reward >= 0) AND (xp_reward <= 1000))),
  constraint daily_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint daily_challenges_pkey PRIMARY KEY (user_id, date)
);

create table if not exists public.events (
  id uuid not null default gen_random_uuid(),
  organizer_id uuid not null,
  title text not null,
  description text,
  cover_image_url text,
  type text default 'meeting'::text,
  starts_at timestamptz not null,
  end_datetime timestamptz,
  location text not null,
  lat double precision,
  lng double precision,
  max_attendees integer,
  created_at timestamptz default now(),
  is_live boolean not null default false,
  constraint events_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint events_pkey PRIMARY KEY (id)
);

create table if not exists public.f1_circuit_images (
  round integer not null,
  url text not null,
  generated_at timestamptz not null default now(),
  constraint f1_circuit_images_pkey PRIMARY KEY (round)
);

create table if not exists public.f1_drivers (
  slug text not null,
  data jsonb not null,
  generated_at timestamptz not null default now(),
  constraint f1_drivers_pkey PRIMARY KEY (slug)
);

create table if not exists public.f1_grid (
  driver_slug text not null,
  name text not null,
  number integer,
  country text,
  team_slug text not null,
  team_color text,
  headshot_url text,
  active boolean not null default true,
  season integer not null default 2026,
  session_key bigint,
  updated_at timestamptz not null default now(),
  points integer,
  position integer,
  constraint f1_grid_pkey PRIMARY KEY (driver_slug)
);

create table if not exists public.f1_grid_teams (
  team_slug text not null,
  name text not null,
  color text,
  season integer not null default 2026,
  updated_at timestamptz not null default now(),
  points integer,
  position integer,
  wins integer,
  constraint f1_grid_teams_pkey PRIMARY KEY (team_slug)
);

create table if not exists public.f1_race_results (
  round integer not null,
  data jsonb not null,
  generated_at timestamptz not null default now(),
  constraint f1_race_results_pkey PRIMARY KEY (round)
);

create table if not exists public.f1_results (
  round integer not null,
  race_name text not null,
  date date,
  winner_slug text,
  winner_name text,
  winner_team_slug text,
  season integer not null default 2026,
  updated_at timestamptz not null default now(),
  constraint f1_results_pkey PRIMARY KEY (round)
);

create table if not exists public.f1_teams (
  slug text not null,
  data jsonb not null,
  generated_at timestamptz not null default now(),
  constraint f1_teams_pkey PRIMARY KEY (slug)
);

create table if not exists public.followers (
  follower_id uuid not null,
  following_id uuid not null,
  created_at timestamptz not null default now(),
  constraint followers_check CHECK ((follower_id <> following_id)),
  constraint followers_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint followers_following_id_fkey FOREIGN KEY (following_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint followers_pkey PRIMARY KEY (follower_id, following_id)
);

create table if not exists public.news (
  id uuid not null default gen_random_uuid(),
  title text not null,
  summary text,
  source text,
  category text,
  url text,
  image_url text,
  published_at timestamptz,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + '48:00:00'::interval),
  translated boolean not null default true,
  constraint news_category_check CHECK ((category = ANY (ARRAY['F1'::text, 'Supercar'::text, 'Hypercar'::text, 'Électrique'::text, 'JDM'::text, 'Classique'::text, 'SUV'::text, 'Events'::text, 'Auto'::text]))),
  constraint news_pkey PRIMARY KEY (id),
  constraint news_url_key UNIQUE (url)
);

create table if not exists public.news_meta (
  id text not null,
  last_fetched_at timestamptz not null default now(),
  constraint news_meta_pkey PRIMARY KEY (id)
);

create table if not exists public.notification_prefs (
  user_id uuid not null,
  likes boolean not null default true,
  comments boolean not null default true,
  followers boolean not null default true,
  nearby boolean not null default true,
  streak boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint notification_prefs_pkey PRIMARY KEY (user_id)
);

create table if not exists public.organizer_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  pseudo text,
  ville text,
  raison text,
  created_at timestamptz not null default now(),
  constraint organizer_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint organizer_requests_pkey PRIMARY KEY (id)
);

create table if not exists public.profiles (
  user_id uuid,
  pseudo text,
  ville text,
  avatar text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_public boolean not null default true,
  role text not null default 'user'::text,
  invite_code text,
  title text,
  last_seen timestamptz,
  garage_brand text,
  instagram text,
  tiktok text,
  onboarding_completed boolean not null default false,
  country text,
  force_relogin boolean not null default false,
  language text,
  dream_car text,
  interests jsonb not null default '[]'::jsonb,
  discovery_source text,
  preferred_brands jsonb not null default '[]'::jsonb,
  preferred_universes jsonb not null default '[]'::jsonb,
  ambition text,
  tier text not null default 'free'::text,
  constraint profiles_ambition_check CHECK (((ambition IS NULL) OR (ambition = ANY (ARRAY['fun'::text, 'ranking'::text, 'city_number_one'::text, 'collection'::text])))),
  constraint profiles_language_check CHECK (((language IS NULL) OR (language = ANY (ARRAY['fr'::text, 'en'::text])))),
  constraint profiles_role_check CHECK ((role = ANY (ARRAY['user'::text, 'organizer'::text, 'admin'::text]))),
  constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint profiles_user_id_key UNIQUE (user_id)
);

create table if not exists public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint push_subscriptions_pkey PRIMARY KEY (id),
  constraint push_subscriptions_endpoint_key UNIQUE (endpoint)
);

create table if not exists public.race_rewards (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  race_id uuid,
  reward_type text not null,
  reward_value jsonb,
  expires_at timestamptz,
  used boolean not null default false,
  created_at timestamptz not null default now(),
  constraint race_rewards_race_id_fkey FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE SET NULL,
  constraint race_rewards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint race_rewards_pkey PRIMARY KEY (id)
);

create table if not exists public.races (
  id uuid not null default gen_random_uuid(),
  player1_id uuid not null,
  player2_id uuid,
  player1_card_id uuid,
  player2_card_id uuid,
  player2_ai jsonb,
  player1_score integer,
  player2_score integer,
  player1_timing_bucket text,
  player1_timing_ms integer,
  winner_id uuid,
  reward_type text,
  reward_value jsonb,
  status text not null default 'pending'::text,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint races_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'forfeit'::text]))),
  constraint races_player1_card_id_fkey FOREIGN KEY (player1_card_id) REFERENCES spots(id) ON DELETE SET NULL,
  constraint races_player1_id_fkey FOREIGN KEY (player1_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint races_player2_card_id_fkey FOREIGN KEY (player2_card_id) REFERENCES spots(id) ON DELETE SET NULL,
  constraint races_player2_id_fkey FOREIGN KEY (player2_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint races_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint races_pkey PRIMARY KEY (id)
);

create table if not exists public.radar_prefs (
  user_id uuid not null,
  enabled boolean not null default false,
  radius_km integer not null default 10,
  lat double precision,
  lng double precision,
  updated_at timestamptz not null default now(),
  constraint radar_prefs_radius_km_check CHECK ((radius_km = ANY (ARRAY[5, 10, 20]))),
  constraint radar_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint radar_prefs_pkey PRIMARY KEY (user_id)
);

create table if not exists public.referrals (
  id uuid not null default gen_random_uuid(),
  referrer_id uuid not null,
  referred_id uuid not null,
  code text not null,
  created_at timestamptz not null default now(),
  constraint referrals_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint referrals_pkey PRIMARY KEY (id),
  constraint referrals_referred_id_key UNIQUE (referred_id)
);

create table if not exists public.spot_count_daily (
  user_id uuid not null,
  date date not null default CURRENT_DATE,
  count integer not null default 0,
  constraint spot_count_daily_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint spot_count_daily_pkey PRIMARY KEY (user_id, date)
);

create table if not exists public.spot_likes (
  id uuid not null default gen_random_uuid(),
  spot_id uuid,
  user_id uuid,
  created_at timestamptz default now(),
  constraint spot_likes_spot_id_fkey FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE,
  constraint spot_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint spot_likes_pkey PRIMARY KEY (id),
  constraint spot_likes_spot_id_user_id_key UNIQUE (spot_id, user_id)
);

create table if not exists public.spots (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  photo_url text not null,
  thumbnail_url text,
  lat double precision not null,
  lng double precision not null,
  brand text not null,
  model text not null,
  year integer,
  color text,
  category text default 'supercar'::text,
  description text,
  ai_confidence integer,
  created_at timestamptz default now(),
  confidence integer,
  expires_at timestamptz not null default (now() + '01:00:00'::interval),
  estimated_price integer,
  car_info jsonb,
  event_id uuid,
  garage_image_url text,
  rarity text default 'standard'::text,
  production integer,
  realistic_render_url text,
  constraint spots_rarity_check CHECK ((rarity = ANY (ARRAY['standard'::text, 'premium'::text, 'performance'::text, 'exclusif'::text, 'supercar'::text, 'hypercar'::text]))),
  constraint spots_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  constraint spots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint spots_pkey PRIMARY KEY (id)
);

create table if not exists public.spotting_predictions (
  user_id uuid not null,
  city text not null,
  date date not null,
  message text not null,
  score_conditions text not null,
  created_at timestamptz not null default now(),
  constraint spotting_predictions_score_conditions_check CHECK ((score_conditions = ANY (ARRAY['bon'::text, 'moyen'::text, 'mauvais'::text]))),
  constraint spotting_predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint spotting_predictions_pkey PRIMARY KEY (user_id, city, date)
);

create table if not exists public.subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  stripe_customer_id text,
  plan text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  constraint subscriptions_plan_check CHECK ((plan = ANY (ARRAY['premium'::text, 'vip'::text]))),
  constraint subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'canceled'::text, 'past_due'::text]))),
  constraint subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint subscriptions_pkey PRIMARY KEY (id),
  constraint subscriptions_stripe_customer_id_key UNIQUE (stripe_customer_id)
);

create table if not exists public.user_challenge_difficulty (
  user_id uuid not null,
  level integer not null default 0,
  last_rolled_week date,
  updated_at timestamptz not null default now(),
  constraint user_challenge_difficulty_level_check CHECK (((level >= 0) AND (level <= 4))),
  constraint user_challenge_difficulty_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_challenge_difficulty_pkey PRIMARY KEY (user_id)
);

create table if not exists public.user_challenges (
  user_id uuid not null,
  challenge_id uuid not null,
  completed_at timestamptz not null default now(),
  constraint user_challenges_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  constraint user_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_challenges_pkey PRIMARY KEY (user_id, challenge_id)
);

create table if not exists public.user_weekly_challenges (
  user_id uuid not null,
  week_start date not null,
  challenge_id uuid not null,
  slot integer not null,
  scaled_target integer not null,
  claimed boolean not null default false,
  completed_at timestamptz,
  assigned_at timestamptz not null default now(),
  constraint user_weekly_challenges_scaled_target_check CHECK ((scaled_target >= 1)),
  constraint user_weekly_challenges_slot_check CHECK (((slot >= 0) AND (slot <= 2))),
  constraint user_weekly_challenges_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  constraint user_weekly_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_weekly_challenges_pkey PRIMARY KEY (user_id, week_start, challenge_id)
);

create table if not exists public.xp_transactions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint xp_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint xp_transactions_pkey PRIMARY KEY (id)
);

-- ═══════════════════════════ INDEX ═══════════════════════════
-- (ceux adossés à une contrainte PRIMARY KEY / UNIQUE sont omis : ils sont
--  déjà créés par la contrainte correspondante ci-dessus.)

CREATE INDEX api_abuse_attempts_created_at_idx ON public.api_abuse_attempts USING btree (created_at DESC);
CREATE INDEX api_abuse_attempts_ip_hash_idx ON public.api_abuse_attempts USING btree (ip_hash, created_at DESC) WHERE (ip_hash IS NOT NULL);
CREATE INDEX brand_follows_brand_idx ON public.brand_follows USING btree (brand);
CREATE INDEX brand_follows_user_idx ON public.brand_follows USING btree (user_id);
CREATE INDEX car_info_cache_updated_at_idx ON public.car_info_cache USING btree (updated_at DESC);
CREATE INDEX car_renders_make_model_idx ON public.car_renders USING btree (lower(make), lower(model));
CREATE INDEX car_specs_fetched_at_idx ON public.car_specs USING btree (fetched_at DESC);
CREATE INDEX challenges_active_idx ON public.challenges USING btree (active, starts_at) WHERE (active = true);
CREATE INDEX comments_spot_idx ON public.comments USING btree (spot_id, created_at);
CREATE INDEX daily_challenges_user_date_idx ON public.daily_challenges USING btree (user_id, date DESC);
CREATE INDEX events_starts_at_idx ON public.events USING btree (starts_at);
CREATE INDEX f1_grid_team_idx ON public.f1_grid USING btree (team_slug);
CREATE INDEX followers_following_idx ON public.followers USING btree (following_id);
CREATE UNIQUE INDEX global_stats_mv_singleton_idx ON public.global_stats_mv USING btree ((1));
CREATE INDEX news_expires_at_idx ON public.news USING btree (expires_at DESC);
CREATE INDEX news_published_at_idx ON public.news USING btree (published_at DESC);
CREATE INDEX organizer_requests_user_idx ON public.organizer_requests USING btree (user_id);
CREATE UNIQUE INDEX profiles_invite_code_uidx ON public.profiles USING btree (invite_code);
CREATE INDEX profiles_last_seen_idx ON public.profiles USING btree (last_seen DESC NULLS LAST) WHERE (last_seen IS NOT NULL);
CREATE INDEX profiles_title_idx ON public.profiles USING btree (title) WHERE (title IS NOT NULL);
CREATE INDEX push_subs_user_idx ON public.push_subscriptions USING btree (user_id);
CREATE INDEX race_rewards_user_idx ON public.race_rewards USING btree (user_id, created_at DESC);
CREATE INDEX races_player1_idx ON public.races USING btree (player1_id, created_at DESC);
CREATE INDEX referrals_referrer_idx ON public.referrals USING btree (referrer_id);
CREATE INDEX spots_created_at_idx ON public.spots USING btree (created_at DESC);
CREATE INDEX spots_event_idx ON public.spots USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX spots_expires_at_idx ON public.spots USING btree (expires_at);
CREATE INDEX spotting_predictions_user_date_idx ON public.spotting_predictions USING btree (user_id, date DESC);
CREATE INDEX uwc_user_week_idx ON public.user_weekly_challenges USING btree (user_id, week_start);
CREATE INDEX xp_user_idx ON public.xp_transactions USING btree (user_id);

-- ═══════════════════════ FONCTIONS & RPC ═══════════════════════

CREATE OR REPLACE FUNCTION public.activate_weekly_challenges()
 RETURNS SETOF challenges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  -- Week starts at Mon 00:00 UTC. date_trunc('week') uses Mon as start
  -- of week in Postgres, which matches the spec.
  v_start := date_trunc('week', now());
  v_end   := v_start + interval '7 days';

  -- If exactly 3 challenges are already active for THIS week, no-op.
  if (
    select count(*) from public.challenges
    where active = true and starts_at = v_start and ends_at = v_end
  ) = 3 then
    return query
      select * from public.challenges
      where active = true and starts_at = v_start and ends_at = v_end
      order by created_at;
    return;
  end if;

  -- Clear stale activations.
  update public.challenges set active = false where active = true;

  -- Pick 3 random library entries.
  update public.challenges
  set active    = true,
      starts_at = v_start,
      ends_at   = v_end
  where id in (
    select id from public.challenges order by random() limit 3
  );

  return query
    select * from public.challenges
    where active = true
    order by created_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_gate_consume(p_user uuid, p_endpoint text, p_day date, p_limit integer, p_cooldown_ms integer)
 RETURNS TABLE(allowed boolean, reason text, used integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
  v_last  timestamptz;
begin
  select u.count, u.last_at
    into v_count, v_last
    from public.ai_usage u
   where u.user_id = p_user
     and u.day = p_day
     and u.endpoint = p_endpoint
   for update;

  if not found then
    v_count := 0;
    v_last := null;
  end if;

  if v_last is not null
     and now() - v_last < make_interval(secs => p_cooldown_ms / 1000.0) then
    return query select false, 'cooldown'::text, v_count;
    return;
  end if;

  if v_count >= p_limit then
    return query select false, 'quota_exceeded'::text, v_count;
    return;
  end if;

  insert into public.ai_usage (user_id, day, endpoint, count, last_at)
  values (p_user, p_day, p_endpoint, 1, now())
  on conflict (user_id, day, endpoint)
  do update set count = public.ai_usage.count + 1, last_at = now();

  return query select true, null::text, v_count + 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_weekly_challenges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assign_weekly_challenges_for(auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_weekly_challenges_for(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week  date := date_trunc('week', now())::date;
  v_level int;
begin
  if p_user is null then return; end if;

  perform public.roll_user_difficulty_for(p_user);

  if exists (
    select 1 from public.user_weekly_challenges
    where user_id = p_user and week_start = v_week
  ) then
    return;
  end if;

  select level into v_level from public.user_challenge_difficulty where user_id = p_user;
  v_level := coalesce(v_level, 0);

  insert into public.user_weekly_challenges
    (user_id, week_start, challenge_id, slot, scaled_target)
  select p_user, v_week, c.id,
         (row_number() over () - 1)::int as slot,
         public.revs_scaled_target(c.target_value, v_level)
  from (
    select id, target_value from public.challenges order by random() limit 3
  ) c;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_claim_challenges_on_spot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := new.user_id;
  v_now  timestamptz := new.created_at;
  c      record;
  v_progress int;
begin
  for c in
    select id, type, target_value, target_brand, target_category,
           xp_reward, title, starts_at, ends_at
    from public.challenges
    where active = true
      and v_now >= starts_at
      and v_now <  ends_at
      and not exists (
        select 1 from public.user_challenges uc
        where uc.user_id = v_user and uc.challenge_id = challenges.id
      )
  loop
    select count(*) into v_progress
    from public.spots s
    where s.user_id = v_user
      and s.created_at >= c.starts_at
      and s.created_at <  c.ends_at
      and (
        (c.type = 'spot_count')
        or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
        or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
      );

    if v_progress >= c.target_value then
      with claim as (
        insert into public.user_challenges (user_id, challenge_id)
        values (v_user, c.id)
        on conflict do nothing
        returning challenge_id
      )
      insert into public.xp_transactions (user_id, amount, reason)
      select v_user, c.xp_reward, 'challenge:' || c.title
      from claim;
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_claim_weekly_challenges_on_spot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := new.user_id;
  v_week date := date_trunc('week', new.created_at)::date;
  c      record;
  v_progress int;
begin
  perform public.assign_weekly_challenges_for(v_user);

  for c in
    select uwc.challenge_id, uwc.scaled_target,
           ch.type, ch.target_brand, ch.target_category, ch.xp_reward, ch.title
    from public.user_weekly_challenges uwc
    join public.challenges ch on ch.id = uwc.challenge_id
    where uwc.user_id = v_user
      and uwc.week_start = v_week
      and uwc.claimed = false
  loop
    select count(*) into v_progress
    from public.spots s
    where s.user_id = v_user
      and s.created_at >= v_week::timestamptz
      and s.created_at <  (v_week + 7)::timestamptz
      and (
        (c.type = 'spot_count')
        or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
        or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
      );

    if v_progress >= c.scaled_target then
      with claim as (
        update public.user_weekly_challenges
        set claimed = true, completed_at = now()
        where user_id = v_user and week_start = v_week
          and challenge_id = c.challenge_id and claimed = false
        returning challenge_id
      )
      insert into public.xp_transactions (user_id, amount, reason)
      select v_user, c.xp_reward, 'challenge:' || c.title
      from claim;
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.award_xp_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  begin
    insert into public.xp_transactions (user_id, amount, reason)
    values (new.organizer_id, 20, 'event');
    return new;
  end; $function$
;

CREATE OR REPLACE FUNCTION public.award_xp_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  owner       uuid;
  daily_like_xp int;
begin
  select user_id into owner from public.spots where id = new.spot_id;
  if owner is null then return new; end if;

  -- Sum the positive +1 entries from today (negatives from revokes
  -- don't count toward the cap, so cap reflects "received today").
  select coalesce(sum(amount), 0) into daily_like_xp
    from public.xp_transactions
   where user_id   = owner
     and reason    = 'like'
     and amount    > 0
     and created_at >= date_trunc('day', now());

  if daily_like_xp < 10 then
    insert into public.xp_transactions (user_id, amount, reason)
    values (owner, 1, 'like');
  end if;

  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.award_xp_spot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.brand_follower_count(p_brand text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.brand_follows where brand = p_brand;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_last_seen()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  update public.profiles set last_seen = now() where user_id = v_user;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_spot_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.spot_count_daily (user_id, date, count)
  values (new.user_id, current_date, 1)
  on conflict (user_id, date)
  do update set count = public.spot_count_daily.count + 1;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.card_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$function$
;

CREATE OR REPLACE FUNCTION public.card_level_for(p_count integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_count >= 20 then 5
    when p_count >= 10 then 4
    when p_count >= 5  then 3
    when p_count >= 3  then 2
    else 1
  end
$function$
;

CREATE OR REPLACE FUNCTION public.card_norm(s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select lower(trim(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g')))
$function$
;

CREATE OR REPLACE FUNCTION public.card_spot_xp_factor(p_ordinal integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_ordinal <= 1  then 1.0
    when p_ordinal <= 3  then 0.5
    when p_ordinal <= 10 then 0.25
    else 0.1
  end
$function$
;

CREATE OR REPLACE FUNCTION public.card_xp_multiplier(p_level integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_level >= 4 then 1.5
    when p_level >= 2 then 1.1
    else 1.0
  end
$function$
;

CREATE OR REPLACE FUNCTION public.city_leaderboard(p_city text, p_limit integer DEFAULT 500)
 RETURNS TABLE(user_id uuid, xp integer, spots integer, pseudo text, avatar text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with city_users as (
    select user_id, pseudo, avatar
    from public.profiles
    where coalesce(lower(trim(ville)), '') = lower(trim(p_city))
  )
  select
    cu.user_id,
    coalesce(x.xp, 0)    as xp,
    coalesce(s.spots, 0) as spots,
    cu.pseudo,
    cu.avatar
  from city_users cu
  left join (
    select user_id, sum(amount)::int as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = cu.user_id
  left join (
    select user_id, count(*)::int as spots
    from public.spots group by user_id
  ) s on s.user_id = cu.user_id
  order by xp desc, spots desc, cu.pseudo asc
  limit greatest(p_limit, 1);
$function$
;

CREATE OR REPLACE FUNCTION public.city_stats(p_city text)
 RETURNS TABLE(total_spots integer, top_car text, top_car_count integer, top_spotter_id uuid, top_spotter_pseudo text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with city_users as (
    select user_id, pseudo
    from public.profiles
    where coalesce(lower(trim(ville)), '') = lower(trim(p_city))
  ),
  city_spots as (
    select s.* from public.spots s
    join city_users cu on cu.user_id = s.user_id
  ),
  top_car_row as (
    select brand || ' ' || model as label, count(*)::int as n
    from city_spots
    where brand <> '' and model <> ''
    group by brand, model
    order by n desc, label asc
    limit 1
  ),
  top_spotter as (
    select s.user_id, count(*)::int as n, cu.pseudo
    from city_spots s
    join city_users cu on cu.user_id = s.user_id
    group by s.user_id, cu.pseudo
    order by n desc
    limit 1
  )
  select
    (select count(*)::int from city_spots),
    (select label from top_car_row),
    (select n     from top_car_row),
    (select user_id from top_spotter),
    (select pseudo  from top_spotter);
$function$
;

CREATE OR REPLACE FUNCTION public.claim_challenge(p_challenge_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user      uuid := auth.uid();
  v_challenge public.challenges%rowtype;
  v_progress  int;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id and active = true;
  if not found then
    return false;
  end if;

  -- Already claimed?
  if exists(select 1 from public.user_challenges where user_id = v_user and challenge_id = p_challenge_id) then
    return false;
  end if;

  -- Recompute progress server-side; never trust the client.
  select count(*) into v_progress
  from public.spots s
  where s.user_id = v_user
    and s.created_at >= v_challenge.starts_at
    and s.created_at <  v_challenge.ends_at
    and (
      (v_challenge.type = 'spot_count')
      or (v_challenge.type = 'spot_brand'    and lower(s.brand)    = lower(v_challenge.target_brand))
      or (v_challenge.type = 'spot_category' and lower(s.category) = lower(v_challenge.target_category))
    );

  if v_progress < v_challenge.target_value then
    return false;
  end if;

  insert into public.user_challenges (user_id, challenge_id) values (v_user, p_challenge_id);

  insert into public.xp_transactions (user_id, amount, reason)
  values (v_user, v_challenge.xp_reward, 'challenge:' || v_challenge.title);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_collection(p_collection_id text)
 RETURNS TABLE(ok boolean, xp integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_xp   int;
begin
  v_xp := case p_collection_id
    when 'amg-collection'   then 300
    when 'british-trio'     then 250
    when 'jdm-legend'       then 200
    when 'italian-big-3'    then 350
    when 'hypercar-club'    then 500
    else null
  end;
  if v_user is null or v_xp is null then
    return query select false, 0;
    return;
  end if;
  if exists(
    select 1 from public.collection_progress
    where user_id = v_user and collection_id = p_collection_id
  ) then
    return query select false, v_xp;
    return;
  end if;
  insert into public.collection_progress (user_id, collection_id, xp_awarded)
    values (v_user, p_collection_id, v_xp);
  insert into public.xp_transactions (user_id, amount, reason)
    values (v_user, v_xp, 'collection:' || p_collection_id);
  return query select true, v_xp;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_daily_challenge()
 RETURNS TABLE(ok boolean, xp_reward integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_today date := current_date;
  v_row public.daily_challenges%rowtype;
begin
  if v_user is null then
    return query select false, 0;
    return;
  end if;
  select * into v_row from public.daily_challenges
    where user_id = v_user and date = v_today;
  if not found then
    return query select false, 0;
    return;
  end if;
  if v_row.completed_at is not null then
    -- Already claimed today — return the original reward so the caller
    -- can still render the "Relevé ✓" state without an extra fetch.
    return query select false, v_row.xp_reward;
    return;
  end if;
  update public.daily_challenges
    set completed_at = now()
    where user_id = v_user and date = v_today;
  insert into public.xp_transactions (user_id, amount, reason)
    values (v_user, v_row.xp_reward, 'daily_challenge');
  return query select true, v_row.xp_reward;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_referral(p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user        uuid := auth.uid();
  v_referrer    uuid;
  v_code        text := upper(trim(p_code));
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  if v_code is null or length(v_code) <> 6 then
    return false;
  end if;

  select user_id into v_referrer from public.profiles where invite_code = v_code;
  if v_referrer is null or v_referrer = v_user then
    return false;
  end if;

  -- Already claimed?
  if exists(select 1 from public.referrals where referred_id = v_user) then
    return false;
  end if;

  insert into public.referrals (referrer_id, referred_id, code)
  values (v_referrer, v_user, v_code);

  insert into public.xp_transactions (user_id, amount, reason) values
    (v_referrer, 50, 'referral:invited'),
    (v_user,     50, 'referral:joined');

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_weekly_challenge(p_challenge_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user      uuid := auth.uid();
  v_week      date := date_trunc('week', now())::date;
  v_row       public.user_weekly_challenges%rowtype;
  v_challenge public.challenges%rowtype;
  v_progress  int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_row from public.user_weekly_challenges
    where user_id = v_user and week_start = v_week and challenge_id = p_challenge_id;
  if not found or v_row.claimed then
    return false;
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then return false; end if;

  v_progress := public.revs_challenge_progress(
    v_user, v_challenge, v_week::timestamptz, (v_week + 7)::timestamptz
  );
  if v_progress < v_row.scaled_target then
    return false;
  end if;

  update public.user_weekly_challenges
    set claimed = true, completed_at = now()
    where user_id = v_user and week_start = v_week and challenge_id = p_challenge_id;

  insert into public.xp_transactions (user_id, amount, reason)
    values (v_user, v_challenge.xp_reward, 'challenge:' || v_challenge.title);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.color_key(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.countries_leaderboard()
 RETURNS TABLE(country text, spotters integer, xp bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(nullif(trim(p.country), ''), 'France') as country,
    count(*)::int                                   as spotters,
    coalesce(sum(x.xp), 0)::bigint                  as xp
  from public.profiles p
  left join (
    select user_id, sum(amount)::bigint as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = p.user_id
  group by 1
  order by xp desc, spotters desc, country asc;
$function$
;

CREATE OR REPLACE FUNCTION public.country_leaderboard(p_country text, p_limit integer DEFAULT 500)
 RETURNS TABLE(user_id uuid, xp integer, spots integer, pseudo text, avatar text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with country_users as (
    select user_id, pseudo, avatar
    from public.profiles
    where coalesce(lower(trim(country)), '') = lower(trim(p_country))
  )
  select
    cu.user_id,
    coalesce(x.xp, 0)    as xp,
    coalesce(s.spots, 0) as spots,
    cu.pseudo,
    cu.avatar
  from country_users cu
  left join (
    select user_id, sum(amount)::int as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = cu.user_id
  left join (
    select user_id, count(*)::int as spots
    from public.spots group by user_id
  ) s on s.user_id = cu.user_id
  order by xp desc, spots desc, cu.pseudo asc
  limit greatest(p_limit, 1);
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_spot_daily_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day_start timestamptz;
  v_tier      text;
  v_limit     integer;
  v_count     integer;
begin
  -- `created_at` est FORCÉ à maintenant. Sans cela le plafond serait
  -- trivialement contournable : la politique RLS n'interdit pas à un client de
  -- fournir sa propre valeur, et il suffirait d'antidater les insertions pour
  -- sortir de la fenêtre de comptage.
  new.created_at := now();

  -- Début de journée en heure de Paris, pas en UTC — même borne que
  -- parisDayStart() côté serveur et côté client, pour que les trois compteurs
  -- basculent au même instant.
  v_day_start := date_trunc('day', now() at time zone 'Europe/Paris')
                   at time zone 'Europe/Paris';

  -- Tier dérivé de l'abonnement Stripe (migration 0015), jamais de
  -- profiles.tier qui n'est jamais écrit.
  begin
    v_tier := public.user_tier(new.user_id);
  exception when others then
    -- Tier illisible → on retombe sur le plafond gratuit. Restrictif, donc
    -- sans danger : un abonné verra une limite basse plutôt qu'un accès
    -- illimité accordé par erreur.
    v_tier := null;
  end;
  v_limit := public.spot_daily_limit(v_tier);

  select count(*) into v_count
    from public.spots s
   where s.user_id = new.user_id
     and s.created_at >= v_day_start;

  if v_count >= v_limit then
    -- Journalisation de la tentative.
    --
    -- Volontairement un RAISE WARNING et PAS une insertion dans
    -- api_abuse_attempts : le RAISE EXCEPTION qui suit annule la transaction,
    -- donc toute ligne écrite ici serait annulée avec elle. Un avertissement
    -- part en revanche dans les logs Postgres et y reste consultable
    -- (Supabase → Logs → Postgres).
    raise warning
      '[spot-quota] user=% tier=% publiés=% limite=% — insertion refusée',
      new.user_id, coalesce(v_tier, 'free'), v_count, v_limit;

    raise exception
      'Limite de % spots par jour atteinte pour le palier %. Réessaie demain.',
      v_limit, coalesce(v_tier, 'free')
      using errcode = 'check_violation',
            hint = 'spot_daily_quota_exceeded';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.event_live_spots(p_event_id uuid, p_limit integer DEFAULT 50)
 RETURNS SETOF spots
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.spots
  where event_id = p_event_id
  order by created_at desc
  limit greatest(p_limit, 1);
$function$
;

CREATE OR REPLACE FUNCTION public.event_live_stats(p_event_id uuid)
 RETURNS TABLE(spot_count integer, participant_count integer, brand_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    (select count(*)::int             from public.spots where event_id = p_event_id),
    (select count(distinct user_id)::int from public.spots where event_id = p_event_id),
    (select count(distinct brand)::int   from public.spots where event_id = p_event_id);
$function$
;

CREATE OR REPLACE FUNCTION public.gen_invite_code()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_i     int;
begin
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    -- Collision check — vanishingly unlikely with 32^6 = 1.07B codes,
    -- but cheap to verify.
    exit when not exists(select 1 from public.profiles where invite_code = v_code);
  end loop;
  return v_code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_active_challenges()
 RETURNS TABLE(id uuid, title text, description text, type text, target_value integer, target_brand text, target_category text, xp_reward integer, starts_at timestamp with time zone, ends_at timestamp with time zone, progress integer, completed boolean, claimed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  return query
    select
      c.id, c.title, c.description, c.type, c.target_value,
      c.target_brand, c.target_category, c.xp_reward,
      c.starts_at, c.ends_at,
      coalesce((
        select count(*)::int
        from public.spots s
        where s.user_id = v_user
          and s.created_at >= c.starts_at
          and s.created_at <  c.ends_at
          and (
            (c.type = 'spot_count')
            or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
            or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
          )
      ), 0) as progress,
      (
        select count(*) from public.spots s
        where s.user_id = v_user
          and s.created_at >= c.starts_at
          and s.created_at <  c.ends_at
          and (
            (c.type = 'spot_count')
            or (c.type = 'spot_brand'    and lower(s.brand)    = lower(c.target_brand))
            or (c.type = 'spot_category' and lower(s.category) = lower(c.target_category))
          )
      ) >= c.target_value as completed,
      exists(
        select 1 from public.user_challenges uc
        where uc.user_id = v_user and uc.challenge_id = c.id
      ) as claimed
    from public.challenges c
    where c.active = true
    order by c.created_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_weekly_challenges()
 RETURNS TABLE(id uuid, title text, description text, type text, target_value integer, target_brand text, target_category text, xp_reward integer, starts_at timestamp with time zone, ends_at timestamp with time zone, progress integer, completed boolean, claimed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
begin
  if v_user is null then return; end if;

  perform public.assign_weekly_challenges();

  return query
    select
      c.id, c.title, c.description, c.type,
      uwc.scaled_target as target_value,
      c.target_brand, c.target_category, c.xp_reward,
      v_week::timestamptz as starts_at,
      (v_week + 7)::timestamptz as ends_at,
      public.revs_challenge_progress(
        v_user, c, v_week::timestamptz, (v_week + 7)::timestamptz
      ) as progress,
      public.revs_challenge_progress(
        v_user, c, v_week::timestamptz, (v_week + 7)::timestamptz
      ) >= uwc.scaled_target as completed,
      uwc.claimed
    from public.user_weekly_challenges uwc
    join public.challenges c on c.id = uwc.challenge_id
    where uwc.user_id = v_user and uwc.week_start = v_week
    order by uwc.slot;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_cards_meta(p_user uuid)
 RETURNS TABLE(spot_id uuid, spots_count integer, is_first_on_revs boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select id, brand, model, created_at
    from public.spots
    where user_id = p_user
  ),
  per_model as (
    select
      lower(s.brand) as br,
      lower(s.model) as md,
      count(*)::int  as cnt,
      min(s.created_at) as earliest_at,
      -- Tie-break by id so concurrent inserts at the same timestamp
      -- pick a deterministic earliest spot.
      (array_agg(s.id order by s.created_at asc, s.id asc))[1] as earliest_id
    from public.spots s
    where (lower(s.brand), lower(s.model)) in (
      select lower(brand), lower(model) from me
    )
    group by lower(s.brand), lower(s.model)
  )
  select
    m.id                     as spot_id,
    p.cnt                    as spots_count,
    (p.earliest_id = m.id)   as is_first_on_revs
  from me m
  left join per_model p
    on p.br = lower(m.brand) and p.md = lower(m.model);
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_race_stats(p_user uuid)
 RETURNS TABLE(wins integer, losses integer, perfect_starts integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*) filter (where winner_id = p_user)::int                                       as wins,
    count(*) filter (where status = 'resolved' and winner_id is null)::int                as losses,
    count(*) filter (where player1_id = p_user and player1_timing_bucket = 'perfect')::int as perfect_starts
  from public.races
  where player1_id = p_user;
$function$
;

CREATE OR REPLACE FUNCTION public.global_search(p_q text, p_limit integer DEFAULT 20)
 RETURNS TABLE(kind text, label text, sublabel text, ref_id text, rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with q as (
    select lower(trim(p_q)) as needle
  ),
  -- Cars: distinct (brand, model) ranked by spot count
  cars as (
    select
      'car'::text as kind,
      s.brand || ' ' || s.model as label,
      count(*)::text || ' spot' || case when count(*) > 1 then 's' else '' end as sublabel,
      (
        select id::text from public.spots s2
        where s2.brand = s.brand and s2.model = s.model
        order by created_at desc limit 1
      ) as ref_id,
      (case when lower(s.brand || ' ' || s.model) like (select needle from q) || '%' then 10 else 5 end) as rank
    from public.spots s
    where lower(s.brand || ' ' || s.model) like '%' || (select needle from q) || '%'
    group by s.brand, s.model
    order by count(*) desc
    limit 8
  ),
  -- Spotters: pseudo match, public profiles only
  spotters as (
    select
      'spotter'::text as kind,
      coalesce(p.pseudo, 'Spotter') as label,
      coalesce(p.ville, '') as sublabel,
      p.user_id::text as ref_id,
      (case when lower(coalesce(p.pseudo, '')) like (select needle from q) || '%' then 9 else 4 end) as rank
    from public.profiles p
    where p.is_public = true
      and p.pseudo is not null
      and lower(p.pseudo) like '%' || (select needle from q) || '%'
    limit 8
  ),
  -- Cities: distinct profile.ville matching, ranked by spot count
  cities as (
    select
      'city'::text as kind,
      p.ville as label,
      count(s.id)::text || ' spot' || case when count(s.id) > 1 then 's' else '' end as sublabel,
      p.ville as ref_id,
      (case when lower(p.ville) like (select needle from q) || '%' then 8 else 3 end) as rank
    from public.profiles p
    join public.spots s on s.user_id = p.user_id
    where p.ville is not null and trim(p.ville) <> ''
      and lower(p.ville) like '%' || (select needle from q) || '%'
    group by p.ville
    order by count(s.id) desc
    limit 5
  ),
  -- Brand hits are computed client-side from the hardcoded BRANDS
  -- list (src/lib/brands.ts) — no canonical brand table in the DB to
  -- query against, and the client list is the source of truth.
  combined as (
    select * from cars
    union all select * from spotters
    union all select * from cities
  )
  select * from combined all_hits
  where length((select needle from q)) >= 2
  order by rank desc, label asc
  limit p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.global_stats()
 RETURNS TABLE(total_spots bigint, top_car text, top_car_count bigint, top_city text, top_city_count bigint, top_brand text, top_brand_count bigint, weekly_active_spotters bigint, refreshed_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    total_spots,
    top_car, top_car_count,
    top_city, top_city_count,
    top_brand, top_brand_count,
    weekly_active_spotters,
    refreshed_at
  from public.global_stats_mv;
$function$
;

CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select 2 * 6371 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2)) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2))
    * sin(radians((lng2 - lng1) / 2)) ^ 2
  ));
$function$
;

CREATE OR REPLACE FUNCTION public.home_community_stats()
 RETURNS TABLE(spots_today integer, online_now integer, top_brand text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  if v_user is not null then
    update public.profiles set last_seen = now() where user_id = v_user;
  end if;
  return query
    select
      (select count(*)::int from public.spots
         where created_at >= v_day_start),
      (select count(*)::int from public.profiles
         where last_seen is not null and last_seen >= now() - interval '5 minutes'),
      (select brand
         from public.spots
         where created_at >= v_day_start and brand <> ''
         group by brand
         order by count(*) desc, brand asc
         limit 1);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.live_events()
 RETURNS TABLE(id uuid, title text, location text, starts_at timestamp with time zone, lat double precision, lng double precision, spot_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    e.id,
    e.title,
    e.location,
    e.starts_at,
    e.lat,
    e.lng,
    (select count(*)::int from public.spots s where s.event_id = e.id) as spot_count
  from public.events e
  where e.is_live = true
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <= now() + interval '3 hours'
  order by e.starts_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.log_api_abuse(p_endpoint text, p_ip_hash text, p_user_agent text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.api_abuse_attempts (endpoint, ip_hash, user_agent, reason)
  values (p_endpoint, p_ip_hash, left(coalesce(p_user_agent, ''), 300), p_reason);

  if random() < 0.01 then
    delete from public.api_abuse_attempts
     where created_at < now() - interval '30 days';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_referral_stats()
 RETURNS TABLE(invite_code text, referred_count integer, xp_from_referrals integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;
  return query
    select
      (select p.invite_code from public.profiles p where p.user_id = v_user),
      (select count(*)::int from public.referrals r where r.referrer_id = v_user),
      coalesce((select sum(amount)::int from public.xp_transactions where user_id = v_user and reason like 'referral:%'), 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_xp()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(sum(amount), 0)::int
    from public.xp_transactions
    where user_id = auth.uid();
  $function$
;

CREATE OR REPLACE FUNCTION public.nearby_live_event(p_lat double precision, p_lng double precision, p_radius_km double precision DEFAULT 5)
 RETURNS TABLE(id uuid, title text, location text, distance_km double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    e.id,
    e.title,
    e.location,
    round(public.haversine_km(e.lat, e.lng, p_lat, p_lng)::numeric, 1)::double precision as distance_km
  from public.events e
  where e.is_live = true
    and e.lat is not null
    and e.lng is not null
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <= now() + interval '3 hours'
    and public.haversine_km(e.lat, e.lng, p_lat, p_lng) <= p_radius_km
  order by distance_km asc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.news_set_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.expires_at is null then
    new.expires_at :=
      coalesce(new.published_at, now()) + interval '48 hours';
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.premium_member_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int
  from public.subscriptions
  where status in ('active', 'trialing')
    and plan is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.pseudo_available(p_pseudo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not exists (
    select 1 from public.profiles
    where lower(trim(pseudo)) = lower(trim(p_pseudo))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.race_card_horsepower(p_card_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spot  public.spots%rowtype;
  v_specs jsonb;
  v_hp    text;
  v_n     int;
begin
  select * into v_spot from public.spots where id = p_card_id;
  if not found then return 200; end if;

  select specs into v_specs from public.card_specs
    where brand = v_spot.brand and model = v_spot.model
    order by updated_at desc nulls last
    limit 1;

  if v_specs is not null then
    v_hp := coalesce(v_specs->>'horsepower', '');
    v_n := nullif(regexp_replace(v_hp, '[^0-9]', '', 'g'), '')::integer;
    if v_n is not null and v_n between 50 and 2500 then
      return v_n;
    end if;
  end if;

  return case coalesce(v_spot.rarity, 'standard')
    when 'hypercar'    then 800
    when 'supercar'    then 600
    when 'exclusif'    then 500
    when 'performance' then 400
    when 'premium'     then 300
    else                    200  -- standard
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.radar_targets(p_spot_id uuid)
 RETURNS TABLE(user_id uuid, distance_km double precision, brand text, model text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spot public.spots%rowtype;
begin
  select * into v_spot from public.spots where id = p_spot_id;
  if not found then
    return;
  end if;

  return query
    select
      rp.user_id,
      round(public.haversine_km(rp.lat, rp.lng, v_spot.lat, v_spot.lng)::numeric, 1)::double precision,
      v_spot.brand,
      v_spot.model
    from public.radar_prefs rp
    where rp.enabled = true
      and rp.lat is not null
      and rp.lng is not null
      and rp.user_id <> v_spot.user_id
      and public.user_tier(rp.user_id) in ('premium', 'vip')
      and public.haversine_km(rp.lat, rp.lng, v_spot.lat, v_spot.lng) <= rp.radius_km;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_global_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  refresh materialized view concurrently public.global_stats_mv;
exception when others then
  -- CONCURRENTLY fails on the very first refresh; fall back once.
  refresh materialized view public.global_stats_mv;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_race(p_race_id uuid, p_tap_delta_ms integer)
 RETURNS TABLE(player_score integer, opponent_score integer, winner_is_me boolean, timing_bucket text, timing_mult numeric, reward_type text, reward_value jsonb, xp_awarded integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_race public.races%rowtype;
  v_clamped int;
  v_p_timing_mult numeric;
  v_o_timing_mult numeric;
  v_timing_bucket text;
  v_p_hp int;
  v_o_hp int;
  v_p_rarity text;
  v_o_rarity text;
  v_p_rmult numeric;
  v_o_rmult numeric;
  v_p_score int;
  v_o_score int;
  v_winner uuid;
  v_xp int;
  v_amount int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_race from public.races
   where id = p_race_id and player1_id = v_user;
  if not found then raise exception 'race not found'; end if;
  if v_race.status <> 'pending' then
    raise exception 'race already resolved';
  end if;

  v_clamped := greatest(-200, least(2500, coalesce(p_tap_delta_ms, 2500)));
  if v_clamped < 0 then
    v_timing_bucket := 'false_start'; v_p_timing_mult := 0.5;
  elsif v_clamped <= 300 then
    v_timing_bucket := 'perfect';     v_p_timing_mult := 1.2;
  elsif v_clamped <= 700 then
    v_timing_bucket := 'good';        v_p_timing_mult := 1.1;
  else
    v_timing_bucket := 'miss';        v_p_timing_mult := 1.0;
  end if;

  -- AI gets a uniformly random timing bucket (1.0, 1.1, or 1.2).
  v_o_timing_mult := case (floor(random() * 3)::int)
    when 0 then 1.0 when 1 then 1.1 else 1.2
  end;

  v_p_hp := public.race_card_horsepower(v_race.player1_card_id);
  select coalesce(rarity, 'commun') into v_p_rarity
    from public.spots where id = v_race.player1_card_id;
  v_p_rmult := case v_p_rarity
    when 'unique'     then 4.0
    when 'ultra_rare' then 2.5
    when 'rare'       then 1.5
    else                   1.0
  end;

  v_o_hp := (v_race.player2_ai->>'horsepower')::int;
  v_o_rarity := v_race.player2_ai->>'rarity';
  v_o_rmult := case v_o_rarity
    when 'unique'     then 4.0
    when 'ultra_rare' then 2.5
    when 'rare'       then 1.5
    else                   1.0
  end;

  v_p_score := (v_p_hp * v_p_rmult * v_p_timing_mult)::int;
  v_o_score := (v_o_hp * v_o_rmult * v_o_timing_mult)::int;

  v_winner := case when v_p_score >= v_o_score then v_user else null end;

  update public.races
     set player1_score         = v_p_score,
         player2_score         = v_o_score,
         player1_timing_ms     = v_clamped,
         player1_timing_bucket = v_timing_bucket,
         winner_id             = v_winner,
         status                = 'resolved',
         resolved_at           = now()
   where id = p_race_id;

  if v_winner = v_user then
    v_amount := coalesce((v_race.reward_value->>'amount')::int, 0);
  else
    -- Consolation
    v_amount := 10;
  end if;

  if v_amount > 0 then
    insert into public.xp_transactions (user_id, amount, reason)
    values (
      v_user,
      v_amount,
      case when v_winner = v_user then 'race:win:' || v_race.reward_type
                                   else 'race:loss' end
    );
  end if;

  v_xp := v_amount;

  return query select
    v_p_score,
    v_o_score,
    (v_winner = v_user),
    v_timing_bucket,
    v_p_timing_mult,
    v_race.reward_type,
    v_race.reward_value,
    v_xp;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_xp_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare owner uuid;
begin
  select user_id into owner from public.spots where id = old.spot_id;
  if owner is not null then
    insert into public.xp_transactions (user_id, amount, reason)
    values (owner, -1, 'like_removed');
  end if;
  return old;
end; $function$
;

CREATE OR REPLACE FUNCTION public.revs_challenge_progress(p_user uuid, p_challenge challenges, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(count(*), 0)::int
  from public.spots s
  where s.user_id = p_user
    and s.created_at >= p_from
    and s.created_at <  p_to
    and (
      (p_challenge.type = 'spot_count')
      or (p_challenge.type = 'spot_brand'    and lower(s.brand)    = lower(p_challenge.target_brand))
      or (p_challenge.type = 'spot_category' and lower(s.category) = lower(p_challenge.target_category))
    );
$function$
;

CREATE OR REPLACE FUNCTION public.revs_scaled_target(p_base integer, p_level integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select greatest(1, p_base + floor(p_base * greatest(0, least(4, p_level)) / 4.0)::int);
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.roll_user_difficulty()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.roll_user_difficulty_for(auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.roll_user_difficulty_for(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week    date := date_trunc('week', now())::date;
  v_prev    date := (date_trunc('week', now()) - interval '7 days')::date;
  v_level   int;
  v_rolled  date;
  v_done    int;
  v_assigned int;
begin
  if p_user is null then return; end if;

  insert into public.user_challenge_difficulty (user_id) values (p_user)
    on conflict (user_id) do nothing;

  select level, last_rolled_week into v_level, v_rolled
    from public.user_challenge_difficulty where user_id = p_user;

  if v_rolled is not null and v_rolled >= v_week then return; end if;

  select count(*) into v_assigned
    from public.user_weekly_challenges where user_id = p_user and week_start = v_prev;

  if v_assigned > 0 then
    select count(*) into v_done
    from public.user_weekly_challenges uwc
    join public.challenges c on c.id = uwc.challenge_id
    where uwc.user_id = p_user and uwc.week_start = v_prev
      and public.revs_challenge_progress(
            p_user, c, v_prev::timestamptz, (v_prev + 7)::timestamptz
          ) >= uwc.scaled_target;

    if v_done >= 2 then
      v_level := least(4, v_level + 1);
    elsif v_done = 0 then
      v_level := greatest(0, v_level - 1);
    end if;
  end if;

  update public.user_challenge_difficulty
    set level = v_level, last_rolled_week = v_week, updated_at = now()
    where user_id = p_user;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.round_spot_coords()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.lat is not null then
    new.lat := round(new.lat::numeric, 3)::double precision;
  end if;
  if new.lng is not null then
    new.lng := round(new.lng::numeric, 3)::double precision;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_card_main_photo(p_spot_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spot public.spots%rowtype;
begin
  select * into v_spot from public.spots where id = p_spot_id;
  if not found or v_spot.user_id <> auth.uid() then
    raise exception 'not allowed';
  end if;
  update public.card_progress set
    main_photo_url = v_spot.photo_url,
    updated_at     = now()
  where user_id  = auth.uid()
    and brand_key = public.card_norm(v_spot.brand)
    and model_key = public.card_norm(v_spot.model)
    and color_key = public.color_key(v_spot.color);
  return v_spot.photo_url;
end; $function$
;

CREATE OR REPLACE FUNCTION public.set_invite_code_if_missing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.invite_code is null then
    new.invite_code := public.gen_invite_code();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.spot_daily_limit(p_tier text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case lower(coalesce(p_tier, 'free'))
    when 'vip'     then 300
    when 'premium' then 30
    else 5              -- free, starter, et tout tier inconnu
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.spot_wars_leaderboard(p_limit integer DEFAULT 10)
 RETURNS TABLE(rank integer, city text, spots_week bigint, total_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranked as (
    select
      coalesce(nullif(trim(p.ville), ''), 'Inconnue') as city,
      count(*)::bigint as spots_week
    from public.spots s
    join public.profiles p on p.user_id = s.user_id
    where s.created_at >= date_trunc('week', now())
      and p.ville is not null
      and trim(p.ville) <> ''
    group by coalesce(nullif(trim(p.ville), ''), 'Inconnue')
  ),
  top as (
    select
      row_number() over (order by spots_week desc, city asc)::int as rank,
      city,
      spots_week
    from ranked
    order by spots_week desc, city asc
    limit greatest(p_limit, 1)
  ),
  best as (
    select coalesce(max(spots_week), 1) as best_count from top
  )
  select
    t.rank,
    t.city,
    t.spots_week,
    round((t.spots_week::numeric / b.best_count::numeric) * 100, 0) as total_pct
  from top t cross join best b
  order by t.rank;
$function$
;

CREATE OR REPLACE FUNCTION public.start_race(p_card_id uuid)
 RETURNS TABLE(race_id uuid, player_hp integer, opponent jsonb, stake_type text, stake_value jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_spot public.spots%rowtype;
  v_hp   integer;
  v_op_rarity text;
  v_op_spot   public.spots%rowtype;
  v_op_hp     integer;
  v_op        jsonb;
  v_op_spot_id uuid;
  v_seed numeric;
  v_seed2 numeric;
  v_stake_type  text;
  v_stake_value jsonb;
  v_race_id uuid;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_spot from public.spots
    where id = p_card_id and user_id = v_user;
  if not found then raise exception 'card not owned'; end if;

  v_hp := public.race_card_horsepower(p_card_id);

  -- 6-tier rarity bucket — biased toward common tiers so a Standard
  -- card player still draws a competitive opponent most of the time.
  -- Cumulative: .45 / .70 / .85 / .93 / .98 / 1.00
  v_seed := random();
  if    v_seed < 0.45 then v_op_rarity := 'standard';
  elsif v_seed < 0.70 then v_op_rarity := 'premium';
  elsif v_seed < 0.85 then v_op_rarity := 'performance';
  elsif v_seed < 0.93 then v_op_rarity := 'exclusif';
  elsif v_seed < 0.98 then v_op_rarity := 'supercar';
  else                     v_op_rarity := 'hypercar';
  end if;

  -- Cascade 1: foreign-user spot of target rarity with a photo
  select * into v_op_spot from public.spots
    where rarity = v_op_rarity
      and photo_url is not null
      and user_id <> v_user
    order by random()
    limit 1;

  -- Cascade 2: any spot of target rarity with a photo
  if not found then
    select * into v_op_spot from public.spots
      where rarity = v_op_rarity
        and photo_url is not null
      order by random()
      limit 1;
  end if;

  -- Cascade 3: any spot with a photo, drop the rarity constraint
  if not found then
    select * into v_op_spot from public.spots
      where photo_url is not null
      order by random()
      limit 1;
  end if;

  if found then
    v_op_hp := public.race_card_horsepower(v_op_spot.id);
    v_op_spot_id := v_op_spot.id;
    v_op := jsonb_build_object(
      'brand',      v_op_spot.brand,
      'model',      v_op_spot.model,
      'rarity',     coalesce(v_op_spot.rarity, 'standard'),
      'horsepower', v_op_hp,
      'photo_url',  v_op_spot.photo_url,
      'spot_id',    v_op_spot.id,
      'year',       v_op_spot.year
    );
  else
    -- Cascade 4: synthetic. Empty DB or no photo-bearing spots.
    v_op_hp := case v_op_rarity
      when 'hypercar'    then 800
      when 'supercar'    then 600
      when 'exclusif'    then 500
      when 'performance' then 400
      when 'premium'     then 300
      else                    200  -- standard
    end;
    v_op_hp := (v_op_hp * (0.85 + random() * 0.30))::int;
    v_op_spot_id := null;
    v_op := jsonb_build_object(
      'brand',      'Phantom',
      'model',      'AI Spec',
      'rarity',     v_op_rarity,
      'horsepower', v_op_hp,
      'photo_url',  null,
      'spot_id',    null,
      'year',       null
    );
  end if;

  -- ────── Stake roll — unchanged from 0038 ──────
  v_seed  := random();
  v_seed2 := random();
  if v_seed < 0.60 then
    if v_seed2 < 0.34 then
      v_stake_type := 'xp_25';  v_stake_value := jsonb_build_object('amount', 25,  'label', '+25 XP');
    elsif v_seed2 < 0.67 then
      v_stake_type := 'xp_50';  v_stake_value := jsonb_build_object('amount', 50,  'label', '+50 XP');
    else
      v_stake_type := 'xp_75';  v_stake_value := jsonb_build_object('amount', 75,  'label', '+75 XP');
    end if;
  elsif v_seed < 0.85 then
    if v_seed2 < 0.34 then
      v_stake_type := 'xp_100'; v_stake_value := jsonb_build_object('amount', 100, 'label', '+100 XP');
    elsif v_seed2 < 0.67 then
      v_stake_type := 'xp_150'; v_stake_value := jsonb_build_object('amount', 150, 'label', '+150 XP');
    else
      v_stake_type := 'xp_200'; v_stake_value := jsonb_build_object('amount', 200, 'label', '+200 XP');
    end if;
  elsif v_seed < 0.97 then
    v_stake_type := 'xp_400';   v_stake_value := jsonb_build_object('amount', 400, 'label', '+400 XP');
  else
    v_stake_type := 'xp_1000';  v_stake_value := jsonb_build_object('amount', 1000, 'label', '+1000 XP');
  end if;

  insert into public.races (
    player1_id, player1_card_id, player2_card_id, player2_ai,
    reward_type, reward_value, status
  )
  values (
    v_user, p_card_id, v_op_spot_id, v_op,
    v_stake_type, v_stake_value, 'pending'
  )
  returning id into v_race_id;

  return query select v_race_id, v_hp, v_op, v_stake_type, v_stake_value;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.top_spotters(limit_count integer DEFAULT 500)
 RETURNS TABLE(user_id uuid, xp integer, spots integer, pseudo text, avatar text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.user_id,
    coalesce(x.xp, 0)::int    as xp,
    coalesce(s.spots, 0)::int as spots,
    p.pseudo,
    p.avatar
  from public.profiles p
  left join (
    select user_id, sum(amount)::int as xp
    from public.xp_transactions group by user_id
  ) x on x.user_id = p.user_id
  left join (
    select user_id, count(*)::int as spots
    from public.spots group by user_id
  ) s on s.user_id = p.user_id
  order by xp desc, spots desc, p.pseudo asc
  limit greatest(limit_count, 1);
$function$
;

CREATE OR REPLACE FUNCTION public.user_tier(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    case
      when status not in ('active', 'trialing') then null
      when plan is null then null
      when plan like 'vip%' or plan = 'vip' then 'vip'
      when plan like 'premium%' or plan = 'premium' then 'premium'
      when plan = 'starter' then 'starter'
      else null
    end
  from public.subscriptions
  where user_id = p_user
  limit 1;
$function$
;

-- ═══════════════════════════ TRIGGERS ═══════════════════════════

CREATE TRIGGER trg_xp_event AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION award_xp_event();
CREATE TRIGGER trg_news_set_expiry BEFORE INSERT ON public.news FOR EACH ROW EXECUTE FUNCTION news_set_expiry();
CREATE TRIGGER profiles_set_invite_code BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_invite_code_if_missing();
CREATE TRIGGER trg_xp_like AFTER INSERT ON public.spot_likes FOR EACH ROW EXECUTE FUNCTION award_xp_like();
CREATE TRIGGER trg_xp_unlike AFTER DELETE ON public.spot_likes FOR EACH ROW EXECUTE FUNCTION revoke_xp_like();
CREATE TRIGGER trg_auto_claim_weekly_challenges AFTER INSERT ON public.spots FOR EACH ROW EXECUTE FUNCTION auto_claim_weekly_challenges_on_spot();
CREATE TRIGGER trg_bump_spot_count AFTER INSERT ON public.spots FOR EACH ROW EXECUTE FUNCTION bump_spot_count();
CREATE TRIGGER trg_enforce_spot_daily_quota BEFORE INSERT ON public.spots FOR EACH ROW EXECUTE FUNCTION enforce_spot_daily_quota();
CREATE TRIGGER trg_round_spot_coords BEFORE INSERT OR UPDATE OF lat, lng ON public.spots FOR EACH ROW EXECUTE FUNCTION round_spot_coords();
CREATE TRIGGER trg_xp_spot AFTER INSERT ON public.spots FOR EACH ROW EXECUTE FUNCTION award_xp_spot();

-- ═══════════════════ ROW LEVEL SECURITY ═══════════════════
-- Une table avec RLS activé et AUCUNE policy est volontairement
-- inaccessible aux clients : seul le service_role la lit ou l'écrit.

alter table public.ai_usage enable row level security;
alter table public.api_abuse_attempts enable row level security;
alter table public.brand_descriptions enable row level security;
alter table public.brand_follows enable row level security;
alter table public.car_catalog enable row level security;
alter table public.car_info_cache enable row level security;
alter table public.car_renders enable row level security;
alter table public.car_specs enable row level security;
alter table public.card_progress enable row level security;
alter table public.challenges enable row level security;
alter table public.collection_progress enable row level security;
alter table public.comments enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.events enable row level security;
alter table public.f1_circuit_images enable row level security;
alter table public.f1_drivers enable row level security;
alter table public.f1_grid enable row level security;
alter table public.f1_grid_teams enable row level security;
alter table public.f1_race_results enable row level security;
alter table public.f1_results enable row level security;
alter table public.f1_teams enable row level security;
alter table public.followers enable row level security;
alter table public.news enable row level security;
alter table public.news_meta enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.organizer_requests enable row level security;
alter table public.profiles enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.race_rewards enable row level security;
alter table public.races enable row level security;
alter table public.radar_prefs enable row level security;
alter table public.referrals enable row level security;
alter table public.spot_count_daily enable row level security;
alter table public.spot_likes enable row level security;
alter table public.spots enable row level security;
alter table public.spotting_predictions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_challenge_difficulty enable row level security;
alter table public.user_challenges enable row level security;
alter table public.user_weekly_challenges enable row level security;
alter table public.xp_transactions enable row level security;

create policy "brand desc public read"
  on public.brand_descriptions
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "brand follows own delete"
  on public.brand_follows
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy "brand follows own insert"
  on public.brand_follows
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "brand follows own read"
  on public.brand_follows
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy "car_catalog_read"
  on public.car_catalog
  as permissive
  for select
  to public
  using (true);

create policy "car info cache public read"
  on public.car_info_cache
  as permissive
  for select
  to public
  using (true);

create policy "car_renders_read"
  on public.car_renders
  as permissive
  for select
  to public
  using (true);

create policy "car_specs read all"
  on public.car_specs
  as permissive
  for select
  to authenticated
  using (true);

create policy "card_progress read own"
  on public.card_progress
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "challenges read all"
  on public.challenges
  as permissive
  for select
  to authenticated
  using (true);

create policy "collection_progress read own"
  on public.collection_progress
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "comment as self"
  on public.comments
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "comments public read"
  on public.comments
  as permissive
  for select
  to public
  using (true);

create policy "delete own comment"
  on public.comments
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy "daily challenges read own"
  on public.daily_challenges
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "Events visibles par tous"
  on public.events
  as permissive
  for select
  to public
  using (true);

create policy "Organisateur peut supprimer ses events"
  on public.events
  as permissive
  for delete
  to public
  using ((auth.uid() = organizer_id));

create policy "Utilisateur peut créer des events"
  on public.events
  as permissive
  for insert
  to public
  with check ((auth.uid() = organizer_id));

create policy "events delete own"
  on public.events
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = organizer_id));

create policy "events insert organizer"
  on public.events
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = organizer_id) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['organizer'::text, 'admin'::text])))))));

create policy "events public read"
  on public.events
  as permissive
  for select
  to public
  using (true);

create policy "events update own"
  on public.events
  as permissive
  for update
  to authenticated
  using ((auth.uid() = organizer_id))
  with check ((auth.uid() = organizer_id));

create policy "f1 circuit images public read"
  on public.f1_circuit_images
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "f1 drivers public read"
  on public.f1_drivers
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "f1 grid public read"
  on public.f1_grid
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "f1 grid teams public read"
  on public.f1_grid_teams
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "f1 race results public read"
  on public.f1_race_results
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "f1 results public read"
  on public.f1_results
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "f1 teams public read"
  on public.f1_teams
  as permissive
  for select
  to anon,authenticated
  using (true);

create policy "follow as self"
  on public.followers
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = follower_id));

create policy "followers public read"
  on public.followers
  as permissive
  for select
  to public
  using (true);

create policy "unfollow as self"
  on public.followers
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = follower_id));

create policy "Anyone can read news"
  on public.news
  as permissive
  for select
  to public
  using (true);

create policy "news readable by everyone"
  on public.news
  as permissive
  for select
  to public
  using (true);

create policy "news_meta_read"
  on public.news_meta
  as permissive
  for select
  to public
  using (true);

create policy "notif prefs own read"
  on public.notification_prefs
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy "notif prefs own update"
  on public.notification_prefs
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy "notif prefs own write"
  on public.notification_prefs
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "org req insert own"
  on public.organizer_requests
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "org req select own"
  on public.organizer_requests
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy "profiles readable"
  on public.profiles
  as permissive
  for select
  to public
  using ((is_public OR (auth.uid() = user_id)));

create policy "users insert own profile"
  on public.profiles
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "users update own profile"
  on public.profiles
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy "push subs own delete"
  on public.push_subscriptions
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy "push subs own insert"
  on public.push_subscriptions
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "push subs own read"
  on public.push_subscriptions
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy "race_rewards read own"
  on public.race_rewards
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "races read own"
  on public.races
  as permissive
  for select
  to authenticated
  using (((player1_id = auth.uid()) OR (player2_id = auth.uid())));

create policy "radar_prefs read own"
  on public.radar_prefs
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "radar_prefs update own"
  on public.radar_prefs
  as permissive
  for update
  to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));

create policy "radar_prefs upsert own"
  on public.radar_prefs
  as permissive
  for insert
  to authenticated
  with check ((user_id = auth.uid()));

create policy "referrals read own"
  on public.referrals
  as permissive
  for select
  to authenticated
  using (((referrer_id = auth.uid()) OR (referred_id = auth.uid())));

create policy "spot count own read"
  on public.spot_count_daily
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy "Users can delete own likes"
  on public.spot_likes
  as permissive
  for delete
  to public
  using ((auth.uid() = user_id));

create policy "Users can manage own likes"
  on public.spot_likes
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));

create policy "Users can read likes"
  on public.spot_likes
  as permissive
  for select
  to public
  using (true);

create policy "spot_likes delete own"
  on public.spot_likes
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy "spot_likes insert own"
  on public.spot_likes
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "spot_likes public read"
  on public.spot_likes
  as permissive
  for select
  to public
  using (true);

create policy "spots delete own"
  on public.spots
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy "spots insert own"
  on public.spots
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy "spots public read"
  on public.spots
  as permissive
  for select
  to public
  using (true);

create policy "spots update own"
  on public.spots
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy "spotting predictions insert own"
  on public.spotting_predictions
  as permissive
  for insert
  to authenticated
  with check ((user_id = auth.uid()));

create policy "spotting predictions read own"
  on public.spotting_predictions
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "Users can read own subscription"
  on public.subscriptions
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));

create policy "ucd read own"
  on public.user_challenge_difficulty
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "user_challenges read own"
  on public.user_challenges
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "uwc read own"
  on public.user_weekly_challenges
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));

create policy "xp readable"
  on public.xp_transactions
  as permissive
  for select
  to public
  using (true);

-- Fin du schéma — 41 tables, 30 index, 65 fonctions, 10 triggers, 70 policies.
