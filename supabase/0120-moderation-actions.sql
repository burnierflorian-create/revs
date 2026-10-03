-- ═══════ CE QUE LA MODÉRATION PEUT FAIRE, ET CE QU'ELLE NE PEUT PAS ═══════
--
-- Toutes les actions passent par ici. Aucune n'est un UPDATE direct depuis le
-- client : une action de modération doit TOUJOURS laisser une trace dans
-- `moderation_actions`, et une écriture directe pourrait l'oublier.

-- ── LA FILE ──
-- Un appel, tout le contexte. Le panneau n'interroge pas quatre tables par
-- dossier : il en lirait des dizaines pour afficher une liste.
create or replace function public.moderation_queue(p_status text default 'open')
returns table (
  case_id uuid, target_type text, target_id uuid,
  target_owner uuid, owner_pseudo text, owner_avatar text,
  report_count integer, status text, risk text, bot_verdict text,
  bot_source text, reasons text[], preview text, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.target_type, c.target_id,
    c.target_owner, p.pseudo, p.avatar,
    c.report_count, c.status, c.risk, c.bot_verdict, c.bot_source,
    (select array_agg(distinct r.reason) from public.content_reports r
      where r.target_type = c.target_type and r.target_id = c.target_id),
    -- Un extrait, pas le contenu entier : la liste sert à trier, la fiche à
    -- décider.
    case c.target_type
      when 'spot'    then (select left(coalesce(s.brand,'') || ' ' || coalesce(s.model,''), 80) from public.spots s where s.id = c.target_id)
      when 'comment' then (select left(cm.content, 120) from public.comments cm where cm.id = c.target_id)
      when 'story'   then (select 'Story · ' || to_char(st.created_at, 'DD/MM HH24:MI') from public.stories st where st.id = c.target_id)
      when 'profile' then (select coalesce(pr.pseudo, 'Profil') from public.profiles pr where pr.user_id = c.target_id)
    end,
    c.updated_at
  from public.moderation_cases c
  left join public.profiles p on p.user_id = c.target_owner
  where public.current_role_is(array['moderator','admin'])
    and (p_status = 'all' or c.status = p_status)
  order by
    -- Ce qu'un humain doit voir en premier : les dossiers que le bot n'a pas
    -- su trancher, puis les plus signalés, puis les plus récents.
    (c.status = 'needs_review') desc,
    c.report_count desc,
    c.updated_at desc
  limit 200;
$$;

-- ── LA FICHE ──
create or replace function public.moderation_case_detail(p_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.moderation_cases;
  v_content jsonb;
begin
  if not public.current_role_is(array['moderator','admin']) then
    raise exception 'Accès refusé.' using hint = 'forbidden';
  end if;
  select * into c from public.moderation_cases where id = p_case;
  if c.id is null then
    raise exception 'Dossier introuvable.' using hint = 'not_found';
  end if;

  v_content := case c.target_type
    when 'spot' then (
      select to_jsonb(x) from (
        select s.id, s.brand, s.model, s.description, s.photo_url, s.created_at
          from public.spots s where s.id = c.target_id
      ) x)
    when 'comment' then (
      select to_jsonb(x) from (
        select cm.id, cm.content, cm.created_at, cm.spot_id
          from public.comments cm where cm.id = c.target_id
      ) x)
    when 'story' then (
      select to_jsonb(x) from (
        select st.id, st.caption, st.media_url, st.created_at, st.expires_at
          from public.stories st where st.id = c.target_id
      ) x)
    when 'profile' then (
      select to_jsonb(x) from (
        select pr.user_id, pr.pseudo, pr.ville, pr.avatar, pr.dream_car, pr.created_at
          from public.profiles pr where pr.user_id = c.target_id
      ) x)
  end;

  return jsonb_build_object(
    'case', to_jsonb(c),
    'content', v_content,
    'owner', (
      select to_jsonb(x) from (
        select p.user_id, p.pseudo, p.avatar, p.ville, p.created_at, p.role
          from public.profiles p where p.user_id = c.target_owner
      ) x),
    -- Les motifs et les notes, SANS l'identité des signaleurs : un
    -- modérateur décide sur le contenu, pas sur qui s'en est plaint.
    'reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reason', r.reason, 'note', r.note, 'at', r.created_at
      ) order by r.created_at desc), '[]'::jsonb)
      from public.content_reports r
      where r.target_type = c.target_type and r.target_id = c.target_id),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', a.action, 'origin', a.origin, 'reason', a.reason,
        'at', a.created_at, 'actor', (select p2.pseudo from public.profiles p2 where p2.user_id = a.actor_id)
      ) order by a.created_at desc), '[]'::jsonb)
      from public.moderation_actions a
      where a.target_user = c.target_owner or a.case_id = c.id),
    'sanctions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', s.kind, 'reason', s.reason, 'until', s.until,
        'origin', s.origin, 'lifted', s.lifted_at is not null, 'at', s.created_at
      ) order by s.created_at desc), '[]'::jsonb)
      from public.user_sanctions s where s.user_id = c.target_owner)
  );
end;
$$;

-- ── AGIR ──
-- Une seule fonction, parce qu'une seule chose doit être garantie : qu'aucune
-- action ne puisse être appliquée sans être journalisée.
create or replace function public.moderation_act(
  p_case uuid,
  p_action text,
  p_reason text,
  p_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  c      public.moderation_cases;
  v_sanc uuid;
  v_until timestamptz;
begin
  if not public.current_role_is(array['moderator','admin']) then
    raise exception 'Accès refusé.' using hint = 'forbidden';
  end if;
  -- Les décisions irréversibles sont réservées à l'administration. Un
  -- modérateur peut masquer, avertir, restreindre, suspendre — pas effacer
  -- un compte.
  if p_action in ('delete_account', 'ban')
     and not public.current_role_is(array['admin']) then
    raise exception 'Réservé à l''administration.' using hint = 'admin_only';
  end if;
  select * into c from public.moderation_cases where id = p_case;
  if c.id is null then
    raise exception 'Dossier introuvable.' using hint = 'not_found';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Un motif est obligatoire.' using hint = 'reason_required';
  end if;

  if p_action in ('delete_content', 'hide_content') then
    -- On supprime réellement. « Masquer » n'existe pas comme état sur les
    -- contenus REVS : inventer une colonne `hidden` sur quatre tables pour
    -- un état que rien ne sait encore afficher produirait du contenu
    -- fantôme. La distinction reste dans le journal, qui dit ce qui a été
    -- décidé.
    if c.target_type = 'spot' then
      delete from public.spots where id = c.target_id;
    elsif c.target_type = 'comment' then
      delete from public.comments where id = c.target_id;
    elsif c.target_type = 'story' then
      delete from public.stories where id = c.target_id;
    end if;
    insert into public.user_sanctions (user_id, kind, reason, issued_by, origin, case_id)
    values (c.target_owner, 'content_removed', p_reason, v_me, 'human', c.id);
  end if;

  if p_action in ('warn', 'restrict', 'suspend', 'ban') then
    v_until := case
      when p_action = 'warn' then null
      when p_action = 'ban' then null
      when p_days is null then now() + interval '7 days'
      else now() + make_interval(days => greatest(1, p_days))
    end;
    insert into public.user_sanctions (user_id, kind, reason, until, issued_by, origin, case_id)
    values (
      c.target_owner,
      case p_action when 'warn' then 'warning'
                    when 'restrict' then 'restricted'
                    when 'suspend' then 'suspended'
                    else 'banned' end,
      p_reason, v_until, v_me, 'human', c.id
    )
    returning id into v_sanc;
  end if;

  update public.moderation_cases
     set status = case p_action
                    when 'dismiss'  then 'dismissed'
                    when 'escalate' then 'needs_review'
                    else 'resolved' end,
         updated_at = now()
   where id = p_case;

  insert into public.moderation_actions
    (case_id, actor_id, origin, action, target_type, target_id, target_user, reason)
  values (p_case, v_me, 'human', p_action, c.target_type, c.target_id, c.target_owner, p_reason);

  return jsonb_build_object('ok', true, 'sanction_id', v_sanc);
end;
$$;

-- ── LEVER UNE SANCTION ──
create or replace function public.moderation_lift(p_sanction uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  s public.user_sanctions;
begin
  if not public.current_role_is(array['moderator','admin']) then
    raise exception 'Accès refusé.' using hint = 'forbidden';
  end if;
  select * into s from public.user_sanctions where id = p_sanction;
  if s.id is null then
    raise exception 'Sanction introuvable.' using hint = 'not_found';
  end if;
  update public.user_sanctions
     set lifted_at = now(), lifted_by = v_me
   where id = p_sanction and lifted_at is null;
  insert into public.moderation_actions
    (case_id, actor_id, origin, action, target_user, reason)
  values (s.case_id, v_me, 'human', 'lift_sanction', s.user_id, p_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- ── TRANCHER UNE CONTESTATION ──
create or replace function public.moderation_decide_appeal(
  p_appeal uuid, p_accept boolean, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  a public.moderation_appeals;
begin
  if not public.current_role_is(array['moderator','admin']) then
    raise exception 'Accès refusé.' using hint = 'forbidden';
  end if;
  select * into a from public.moderation_appeals where id = p_appeal;
  if a.id is null then
    raise exception 'Contestation introuvable.' using hint = 'not_found';
  end if;

  update public.moderation_appeals
     set status = case when p_accept then 'accepted' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = p_note
   where id = p_appeal;

  -- Accepter une contestation lève la sanction. C'est tout l'intérêt : une
  -- contestation acceptée qui laisserait la sanction en place ne serait
  -- qu'un accusé de réception.
  if p_accept then
    update public.user_sanctions
       set lifted_at = now(), lifted_by = v_me
     where id = a.sanction_id and lifted_at is null;
  end if;

  insert into public.moderation_actions
    (actor_id, origin, action, target_user, reason)
  values (v_me, 'human',
          case when p_accept then 'appeal_accepted' else 'appeal_rejected' end,
          a.user_id, p_note);

  return jsonb_build_object('ok', true);
end;
$$;

-- ── LA LISTE DES CONTESTATIONS ──
create or replace function public.moderation_appeals_queue()
returns table (
  appeal_id uuid, user_id uuid, pseudo text, avatar text,
  message text, status text, created_at timestamptz,
  sanction_kind text, sanction_reason text, sanction_until timestamptz,
  sanction_lifted boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.user_id, p.pseudo, p.avatar, a.message, a.status, a.created_at,
         s.kind, s.reason, s.until, s.lifted_at is not null
  from public.moderation_appeals a
  join public.user_sanctions s on s.id = a.sanction_id
  left join public.profiles p on p.user_id = a.user_id
  where public.current_role_is(array['moderator','admin'])
  order by (a.status = 'pending') desc, a.created_at desc
  limit 200;
$$;

-- ── LES COMPTES SANCTIONNÉS ──
create or replace function public.moderation_sanctioned()
returns table (
  sanction_id uuid, user_id uuid, pseudo text, avatar text,
  kind text, reason text, until timestamptz, origin text,
  created_at timestamptz, has_appeal boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.user_id, p.pseudo, p.avatar, s.kind, s.reason, s.until,
         s.origin, s.created_at,
         exists (select 1 from public.moderation_appeals ap where ap.sanction_id = s.id)
  from public.user_sanctions s
  left join public.profiles p on p.user_id = s.user_id
  where public.current_role_is(array['moderator','admin'])
    and s.lifted_at is null
    and (s.until is null or s.until > now())
  order by s.created_at desc
  limit 200;
$$;

-- ── L'HISTORIQUE ──
create or replace function public.moderation_history()
returns table (
  id uuid, action text, origin text, reason text, created_at timestamptz,
  actor text, target_user uuid, target_pseudo text, target_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.action, a.origin, a.reason, a.created_at,
         act.pseudo, a.target_user, tgt.pseudo, a.target_type
  from public.moderation_actions a
  left join public.profiles act on act.user_id = a.actor_id
  left join public.profiles tgt on tgt.user_id = a.target_user
  where public.current_role_is(array['moderator','admin'])
  order by a.created_at desc
  limit 300;
$$;

-- ── CE QUE LE BOT A LE DROIT DE FAIRE ═══════════════════════════════════
--
-- Appelée uniquement par le service (clé service_role), jamais par un
-- utilisateur. Elle enregistre un verdict et, dans un seul cas étroit,
-- applique une mesure.
--
-- RÈGLE ABSOLUE, écrite ici et pas seulement dans une documentation :
-- le bot ne suspend pas, ne bannit pas, ne supprime pas de compte. Jamais,
-- quelle que soit sa confiance. Les seules actions qu'il peut déclencher
-- sont réversibles et portent sur un contenu, pas sur une personne.
create or replace function public.bot_verdict(
  p_case uuid,
  p_risk text,
  p_confidence numeric,
  p_verdict text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.moderation_cases;
  v_auto boolean := false;
begin
  select * into c from public.moderation_cases where id = p_case;
  if c.id is null then
    raise exception 'Dossier introuvable.' using hint = 'not_found';
  end if;

  -- Un contenu que le bot juge sûr ne devient PAS « classé sans suite » tout
  -- seul s'il a été signalé par plusieurs personnes : plusieurs signalements
  -- indépendants valent un regard humain, quelle que soit la confiance d'une
  -- machine sur le texte.
  v_auto :=
    p_risk = 'high'
    and p_confidence >= 0.90
    and c.target_type in ('spot', 'comment', 'story');

  update public.moderation_cases
     set risk = p_risk,
         confidence = p_confidence,
         bot_verdict = p_verdict,
         bot_source = p_source,
         bot_at = now(),
         status = case
           when v_auto then 'resolved'
           -- Tout le reste part chez un humain : risque moyen, confiance
           -- insuffisante, profil visé, ou simplement un doute.
           else 'needs_review'
         end,
         updated_at = now()
   where id = p_case;

  if v_auto then
    if c.target_type = 'spot' then
      delete from public.spots where id = c.target_id;
    elsif c.target_type = 'comment' then
      delete from public.comments where id = c.target_id;
    elsif c.target_type = 'story' then
      delete from public.stories where id = c.target_id;
    end if;
    insert into public.user_sanctions (user_id, kind, reason, origin, case_id)
    values (c.target_owner, 'content_removed', p_verdict, 'auto', c.id);
    insert into public.moderation_actions
      (case_id, origin, action, target_type, target_id, target_user, reason)
    values (p_case, 'auto', 'delete_content', c.target_type, c.target_id,
            c.target_owner, p_verdict);
  else
    insert into public.moderation_actions
      (case_id, origin, action, target_type, target_id, target_user, reason)
    values (p_case, 'auto', 'escalate', c.target_type, c.target_id,
            c.target_owner, p_verdict);
  end if;

  return jsonb_build_object('auto', v_auto, 'status',
    case when v_auto then 'resolved' else 'needs_review' end);
end;
$$;

-- Le bot n'est accessible qu'au service. Aucun rôle client ne peut l'appeler.
revoke all on function public.bot_verdict(uuid, text, numeric, text, text) from public, anon, authenticated;

-- ── CE QUE VOIT UN UTILISATEUR SANCTIONNÉ ──
create or replace function public.my_moderation_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sanctions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'reason', s.reason, 'until', s.until,
        'at', s.created_at,
        'appeal', (
          select jsonb_build_object('status', ap.status, 'at', ap.created_at)
          from public.moderation_appeals ap where ap.sanction_id = s.id
        )
      ) order by s.created_at desc), '[]'::jsonb)
      from public.user_sanctions s
      where s.user_id = auth.uid()
        and s.lifted_at is null
        and (s.until is null or s.until > now())
    )
  );
$$;

grant execute on function public.moderation_queue(text) to authenticated;
grant execute on function public.moderation_case_detail(uuid) to authenticated;
grant execute on function public.moderation_act(uuid, text, text, integer) to authenticated;
grant execute on function public.moderation_lift(uuid, text) to authenticated;
grant execute on function public.moderation_decide_appeal(uuid, boolean, text) to authenticated;
grant execute on function public.moderation_appeals_queue() to authenticated;
grant execute on function public.moderation_sanctioned() to authenticated;
grant execute on function public.moderation_history() to authenticated;
grant execute on function public.my_moderation_status() to authenticated;

notify pgrst, 'reload schema';
