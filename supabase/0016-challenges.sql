-- ─────────────────────── Weekly Challenges ───────────────────────
-- A small curated library of challenges. Each week the cron picks 3
-- and marks them active by setting starts_at/ends_at to the upcoming
-- Mon→Sun window. Users see only the active ones and their personal
-- progress, which is computed on-demand from `spots`.

create table if not exists public.challenges (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text not null,
  -- spot_brand: count spots matching target_brand
  -- spot_count: any spots
  -- spot_category: spots in target_category (e.g. hypercar, JDM)
  type            text not null check (type in ('spot_brand', 'spot_count', 'spot_category')),
  target_value    integer not null default 1,
  target_brand    text,
  target_category text,
  xp_reward       integer not null default 50,
  starts_at       timestamptz,
  ends_at         timestamptz,
  active          boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists challenges_active_idx
  on public.challenges (active, starts_at)
  where active = true;

alter table public.challenges enable row level security;

drop policy if exists "challenges read all"      on public.challenges;
drop policy if exists "challenges write service" on public.challenges;

create policy "challenges read all"
  on public.challenges
  for select
  to authenticated
  using (true);

-- Tracks XP redemption + completion timestamp. Progress itself is
-- derived from spots, so this row is essentially a "claimed" marker.
create table if not exists public.user_challenges (
  user_id      uuid not null references auth.users (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

alter table public.user_challenges enable row level security;

drop policy if exists "user_challenges read own" on public.user_challenges;
create policy "user_challenges read own"
  on public.user_challenges
  for select
  to authenticated
  using (user_id = auth.uid());

-- ─────────────────────── Library seed ───────────────────────
-- A pool the cron picks from. Idempotent: only insert when the
-- (title) row is missing.

insert into public.challenges (title, description, type, target_value, target_brand, xp_reward)
select * from (values
  ('Chasseur Ferrari',        'Spotte une Ferrari cette semaine',         'spot_brand', 1, 'Ferrari',        50),
  ('Chasseur Lamborghini',    'Spotte une Lamborghini cette semaine',     'spot_brand', 1, 'Lamborghini',    50),
  ('Chasseur Porsche',        'Spotte une Porsche cette semaine',         'spot_brand', 1, 'Porsche',        40),
  ('Bavaria Tour',            'Spotte une BMW, Audi ou Mercedes (×3)',    'spot_count', 3, null,             30),
  ('Italian Job',             'Spotte 2 voitures italiennes',             'spot_count', 2, null,             40),
  ('Cinq c''est mieux',       'Spotte 5 voitures cette semaine',          'spot_count', 5, null,             30),
  ('Première hypercar',       'Spotte une hypercar',                      'spot_category', 1, null,          100),
  ('JDM Hunter',              'Spotte une voiture JDM',                   'spot_category', 1, null,          60),
  ('Youngtimer collector',    'Spotte une youngtimer',                    'spot_category', 1, null,          40),
  ('Classique avant tout',    'Spotte une voiture classique',             'spot_category', 1, null,          40),
  ('Marathon du week-end',    'Spotte 10 voitures cette semaine',         'spot_count', 10, null,            80),
  ('Étoile Mercedes',         'Spotte 2 Mercedes',                        'spot_brand', 2, 'Mercedes',       40),
  ('Bleu de Maranello',       'Spotte une Bugatti, Koenigsegg ou Pagani', 'spot_category', 1, null,          150),
  ('Roi de l''Audi',          'Spotte 3 Audi',                            'spot_brand', 3, 'Audi',           50)
) as v(title, description, type, target_value, target_brand, xp_reward)
where not exists (
  select 1 from public.challenges c where c.title = v.title
);

-- Targeted-category challenges need the column populated separately
-- because the values() block above was easier to read with one column
-- mode. We update them after the insert so the pool stays consistent.
update public.challenges set target_category = 'hypercar'   where title = 'Première hypercar'  and target_category is null;
update public.challenges set target_category = 'JDM'        where title = 'JDM Hunter'         and target_category is null;
update public.challenges set target_category = 'youngtimer' where title = 'Youngtimer collector' and target_category is null;
update public.challenges set target_category = 'classic'    where title = 'Classique avant tout' and target_category is null;
update public.challenges set target_category = 'hypercar'   where title = 'Bleu de Maranello'  and target_category is null;

-- ─────────────────────── RPCs ───────────────────────

-- Picks 3 random library challenges, activates them for the current
-- Mon 00:00 → next Mon 00:00 window. Deactivates the rest. Idempotent
-- within a single week: if 3 are already active for this week, returns
-- them unchanged. Designed to be called by a cron every Monday but
-- safe to call any time.
create or replace function public.activate_weekly_challenges()
returns setof public.challenges
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.activate_weekly_challenges() from public;
grant execute on function public.activate_weekly_challenges() to service_role;

-- Returns active challenges + the caller's progress + completion
-- status. Progress is counted from public.spots; completion is
-- whether they've claimed the XP yet (row in user_challenges).
create or replace function public.get_active_challenges()
returns table (
  id              uuid,
  title           text,
  description     text,
  type            text,
  target_value    integer,
  target_brand    text,
  target_category text,
  xp_reward       integer,
  starts_at       timestamptz,
  ends_at         timestamptz,
  progress        integer,
  completed       boolean,
  claimed         boolean
)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.get_active_challenges() to authenticated;

-- Claim XP for a completed challenge. Idempotent — second call is
-- a no-op and just returns false. Returns true on first successful
-- claim.
create or replace function public.claim_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.claim_challenge(uuid) to authenticated;
