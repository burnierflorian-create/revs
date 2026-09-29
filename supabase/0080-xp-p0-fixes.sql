-- ════════════════════════════════════════════════════════════════════════
--  0080 — Fermeture des deux failles P0 restantes
-- ════════════════════════════════════════════════════════════════════════
--
-- L'audit du 29/09 a identifié trois failles P0. Deux sont traitées ici ; la
-- troisième (le drain d'XP par like/unlike) l'est en 0078.
--
--   P0-1  claim_collection() ne vérifiait PAS que la collection était
--         complétée. Elle lisait un montant dans un `case`, vérifiait qu'on ne
--         l'avait pas déjà prise, et créditait. N'importe quel compte pouvait
--         appeler les cinq identifiants et encaisser 1 600 XP — le niveau 30
--         de la nouvelle échelle, sans publier un seul spot.
--
--   P0-2  start_race() / resolve_race() n'avaient AUCUNE limite : ni quota,
--         ni délai, ni plafond. Minimum 10 XP par appel (lot de consolation
--         inconditionnel), jusqu'à 1 000 XP par victoire. Une boucle scriptée
--         atteignait n'importe quel niveau en quelques heures.

-- ════════════ P0-1 · Collections ════════════
--
-- Les règles vivaient uniquement dans `src/lib/collections.ts`, sous forme
-- d'expressions régulières JavaScript. Elles sont portées ici à l'identique :
-- Postgres accepte les mêmes motifs avec `~*` (insensible à la casse) et
-- `\y` en équivalent de `\b`.
--
-- Point de vérité : les MONTANTS restent ceux du `case` d'origine, inchangés.
-- Seule la vérification manquait.

create or replace function public.revs_collection_complete(
  p_user uuid,
  p_id   text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_n int;
begin
  if p_user is null then return false; end if;

  case p_id
    -- 5 modèles Mercedes-AMG DISTINCTS.
    when 'amg-collection' then
      select count(distinct public.card_norm(model)) into v_n
        from public.spots
       where user_id = p_user
         and brand ~* '(mercedes[- ]?amg|amg gt|amg\y)';
      return v_n >= 5;

    -- Une McLaren ET une Aston Martin ET une Bentley.
    when 'british-trio' then
      return exists (select 1 from public.spots where user_id = p_user and brand ~* '\ymclaren\y')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* 'aston[- ]?martin')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '\ybentley\y');

    -- Les cinq japonaises.
    when 'jdm-legend' then
      return exists (select 1 from public.spots where user_id = p_user and brand ~* '\ytoyota\y')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '(\ynissan\y|\ynismo\y)')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '(\yhonda\y|\yacura\y)')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '(\ymazda\y|\ymazdaspeed\y)')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '\ysubaru\y');

    -- Les trois italiennes.
    when 'italian-big-3' then
      return exists (select 1 from public.spots where user_id = p_user and brand ~* '\yferrari\y')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '(\ylamborghini\y|\ylambo\y)')
         and exists (select 1 from public.spots where user_id = p_user and brand ~* '\ymaserati\y');

    -- N'IMPORTE LAQUELLE des quatre suffit (règle « any-of »).
    when 'hypercar-club' then
      return exists (
        select 1 from public.spots
         where user_id = p_user
           and brand ~* '(\ybugatti\y|\ykoenigsegg\y|\ypagani\y|\yrimac\y)'
      );

    else
      return false;
  end case;
end;
$$;

comment on function public.revs_collection_complete(uuid, text) is
  'Vérifie côté serveur qu''une collection est réellement complétée. Portage fidèle des règles de src/lib/collections.ts.';

create or replace function public.claim_collection(p_collection_id text)
returns table (ok boolean, xp integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_xp   int;
begin
  -- Montants inchangés : la refonte ne touche pas au barème des collections,
  -- elle ajoute la vérification qui manquait.
  v_xp := case p_collection_id
    when 'amg-collection'   then 300
    when 'british-trio'     then 250
    when 'jdm-legend'       then 200
    when 'italian-big-3'    then 350
    when 'hypercar-club'    then 500
    else null
  end;

  if v_user is null or v_xp is null then
    return query select false, 0; return;
  end if;

  if exists (
    select 1 from public.collection_progress
    where user_id = v_user and collection_id = p_collection_id
  ) then
    return query select false, v_xp; return;
  end if;

  -- ── LA VÉRIFICATION QUI MANQUAIT ──
  if not public.revs_collection_complete(v_user, p_collection_id) then
    return query select false, 0; return;
  end if;

  insert into public.collection_progress (user_id, collection_id, xp_awarded)
    values (v_user, p_collection_id, v_xp);

  insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (v_user, v_xp, 'collection:' || p_collection_id, 'collection',
            md5(v_user::text || ':collection:' || p_collection_id)::uuid)
  on conflict do nothing;

  return query select true, v_xp;
end;
$$;

-- ════════════ P0-2 · REVS RACE ════════════
--
-- Trois verrous, du moins au plus contraignant :
--   · 20 courses par jour parisien maximum ;
--   · 20 secondes entre deux départs ;
--   · une seule course en attente à la fois — sans quoi il suffisait d'ouvrir
--     mille courses puis de les résoudre en rafale.
--
-- Pourquoi 20 et non 5 : une session de jeu normale enchaîne volontiers dix
-- courses. À 20 courses gagnées au tirage moyen (~145 XP), le plafond
-- théorique est de ~2 900 XP/jour — comparable à une très grosse journée de
-- spots, donc dans l'épure. Ce n'est plus une source infinie.

-- La logique de jeu existante est déplacée telle quelle dans
-- start_race_unchecked() : pas une ligne n'en est réécrite. Le nouveau
-- start_race() n'ajoute que les garde-fous, puis l'appelle.
CREATE OR REPLACE FUNCTION public.start_race_unchecked(p_card_id uuid)
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
$function$;


create or replace function public.start_race(p_card_id uuid)
returns table (race_id uuid, player_hp integer, opponent jsonb, stake_type text, stake_value jsonb)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_today int;
  v_last  timestamptz;
  v_pending int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  -- Quota journalier, borné sur Europe/Paris comme le reste de l'économie.
  select count(*) into v_today
    from public.races
   where player1_id = v_user
     and (created_at at time zone 'Europe/Paris')::date
         = (now() at time zone 'Europe/Paris')::date;
  if v_today >= 20 then
    raise exception 'Limite de courses atteinte pour aujourd''hui.'
      using hint = 'race_daily_limit';
  end if;

  -- Délai entre deux départs.
  select max(created_at) into v_last
    from public.races where player1_id = v_user;
  if v_last is not null and now() - v_last < interval '20 seconds' then
    raise exception 'Patiente quelques secondes avant la prochaine course.'
      using hint = 'race_cooldown';
  end if;

  -- Une seule course en attente : empêche d'ouvrir un stock de courses.
  select count(*) into v_pending
    from public.races
   where player1_id = v_user and status = 'pending';
  if v_pending >= 1 then
    raise exception 'Termine ta course en cours avant d''en lancer une autre.'
      using hint = 'race_pending';
  end if;

  return query select * from public.start_race_unchecked(p_card_id);
end;
$$;

comment on function public.start_race(uuid) is
  'Garde-fous anti-farming (29/09/2026) : 20 courses/jour parisien, 20 s entre deux départs, une seule course en attente. La logique de jeu vit dans start_race_unchecked().';

-- Les gains de course portent désormais leur source ( + id de course) :
-- l'index d'idempotence du grand livre rend un double crédit impossible, même
-- si un appel était rejoué.
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
    insert into public.xp_transactions (user_id, amount, reason, source_table, source_id)
    values (
      v_user,
      v_amount,
      case when v_winner = v_user then 'race:win:' || v_race.reward_type
                                   else 'race:loss' end,
      'races', p_race_id
    )
    on conflict do nothing;
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
$function$;
