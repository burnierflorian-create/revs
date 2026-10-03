-- ═══════ ZÉRO SANCTION AUTOMATIQUE — GARANTI PAR LA BASE ═══════
--
-- La consigne a changé, et elle est plus stricte que ce qui existait : pour
-- la bêta, AUCUNE sanction ne doit être appliquée par une machine. Même une
-- suppression de contenu, même réversible, même avec une confiance de 0,99.
--
-- La version précédente de `bot_verdict()` supprimait un contenu au-delà de
-- 0,90 de confiance. Ce n'est plus permis. La fonction ci-dessous ne sait
-- plus écrire que trois choses : un niveau de risque, une priorité, et un
-- commentaire interne. Elle n'a aucune instruction de suppression, aucune
-- écriture dans `user_sanctions`, et son seul statut de sortie est
-- `needs_review`.
--
-- Ce n'est pas une promesse d'interface : c'est la seule porte par laquelle
-- le service peut écrire un verdict, et elle ne mène nulle part ailleurs.

-- ── PRIORITÉ ──
-- Priorité ≠ culpabilité. Un dossier « urgent » veut dire « à regarder
-- vite », jamais « coupable ». La colonne existe pour ordonner une file
-- d'attente, et rien d'autre ne la lit.
alter table public.moderation_cases
  add column if not exists priority text not null default 'normal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'moderation_cases_priority_check'
  ) then
    alter table public.moderation_cases
      add constraint moderation_cases_priority_check
      check (priority in ('normal', 'high', 'urgent'));
  end if;
end $$;

create index if not exists moderation_cases_priority_idx
  on public.moderation_cases (priority, updated_at desc);

-- ── LA DEMANDE D'EXPLICATION ──
-- Avant de sanctionner un cas ambigu, pouvoir demander le contexte à la
-- personne concernée. Un échange minimal, dans le dossier — pas une
-- messagerie.
create table if not exists public.moderation_questions (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.moderation_cases (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  question   text not null,
  answer     text,
  asked_by   uuid references auth.users (id) on delete set null,
  asked_at   timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists moderation_questions_user_idx
  on public.moderation_questions (user_id, asked_at desc);

alter table public.moderation_questions enable row level security;

drop policy if exists "read own questions" on public.moderation_questions;
create policy "read own questions" on public.moderation_questions
  for select to authenticated
  using (auth.uid() = user_id or public.current_role_is(array['moderator','admin']));

-- La personne ne peut écrire QUE sa réponse, et seulement sur sa propre
-- ligne. La question, elle, vient de la modération.
drop policy if exists "answer own question" on public.moderation_questions;
create policy "answer own question" on public.moderation_questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select on public.moderation_questions to authenticated;
grant update (answer, answered_at) on public.moderation_questions to authenticated;

-- ═══════ LE BOT, RÉDUIT À SON RÔLE ═══════
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
  v_priority text;
begin
  select * into c from public.moderation_cases where id = p_case;
  if c.id is null then
    raise exception 'Dossier introuvable.' using hint = 'not_found';
  end if;

  -- La priorité combine ce que pense la machine ET le nombre de voix
  -- indépendantes. Ni l'un ni l'autre n'établit une faute : ils décident
  -- seulement de l'ordre dans lequel un humain regarde.
  v_priority := case
    when p_risk = 'high' and p_confidence >= 0.85 then 'urgent'
    when c.report_count >= 3 then 'urgent'
    when p_risk = 'high' or c.report_count >= 2 then 'high'
    else 'normal'
  end;

  update public.moderation_cases
     set risk = p_risk,
         confidence = p_confidence,
         bot_verdict = p_verdict,
         bot_source = p_source,
         bot_at = now(),
         priority = v_priority,
         -- UNE seule issue possible. Il n'existe aucune branche de ce code
         -- qui classe, supprime ou sanctionne.
         status = 'needs_review',
         updated_at = now()
   where id = p_case;

  insert into public.moderation_actions
    (case_id, origin, action, target_type, target_id, target_user, reason)
  values (p_case, 'auto', 'escalate', c.target_type, c.target_id,
          c.target_owner, p_verdict);

  return jsonb_build_object('auto', false, 'priority', v_priority,
                            'status', 'needs_review');
end;
$$;

comment on function public.bot_verdict(uuid, text, numeric, text, text) is
  'Classe un dossier et le remet à un humain. N''applique AUCUNE sanction : '
  'aucune branche de cette fonction ne supprime un contenu ni n''écrit dans '
  'user_sanctions. C''est la seule porte d''écriture du verdict automatique.';

revoke all on function public.bot_verdict(uuid, text, numeric, text, text)
  from public, anon, authenticated;

-- ── GARDE-FOU : AUCUNE SANCTION NE PEUT ÊTRE D'ORIGINE AUTOMATIQUE ──
-- Le cran du dessous. Même si un jour quelqu'un réécrit une fonction qui
-- essaie d'insérer une sanction automatique, la table la refuse.
create or replace function public.no_automatic_sanction()
returns trigger
language plpgsql
as $$
begin
  if new.origin = 'auto' then
    raise exception 'Aucune sanction ne peut être appliquée automatiquement.'
      using hint = 'human_review_required';
  end if;
  if new.issued_by is null then
    raise exception 'Une sanction doit porter l''identifiant de qui l''a décidée.'
      using hint = 'actor_required';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_no_automatic_sanction on public.user_sanctions;
create trigger trg_no_automatic_sanction
  before insert on public.user_sanctions
  for each row execute function public.no_automatic_sanction();

-- Les sanctions automatiques déjà posées par l'ancienne version sont levées :
-- elles ont été décidées par une machine, ce que la règle interdit désormais.
update public.user_sanctions
   set lifted_at = coalesce(lifted_at, now())
 where origin = 'auto' and lifted_at is null;

-- ── SIGNALEURS SUSPECTS ──
-- On ne sanctionne pas un signaleur automatiquement non plus. On le signale
-- à l'administration, qui jugera.
create or replace function public.suspicious_reporters()
returns table (
  user_id uuid, pseudo text, total integer, dismissed integer,
  distinct_targets integer, last_24h integer, reason text
)
language sql
stable
security definer
set search_path = public
as $$
  with stats as (
    select
      r.reporter_id as uid,
      count(*)::int as total,
      count(*) filter (where c.status = 'dismissed')::int as dismissed,
      count(distinct r.target_owner)::int as targets,
      count(*) filter (where r.created_at > now() - interval '24 hours')::int as recent
    from public.content_reports r
    left join public.moderation_cases c
      on c.target_type = r.target_type and c.target_id = r.target_id
    group by r.reporter_id
  )
  select
    s.uid, p.pseudo, s.total, s.dismissed, s.targets, s.recent,
    case
      when s.recent >= 10 then 'Beaucoup de signalements en 24 h'
      when s.total >= 5 and s.dismissed::numeric / s.total >= 0.8
        then 'La plupart de ses signalements sont classés sans suite'
      when s.targets = 1 and s.total >= 4
        then 'Signale la même personne de façon répétée'
      else null
    end as reason
  from stats s
  left join public.profiles p on p.user_id = s.uid
  where public.current_role_is(array['moderator','admin'])
    and (
      s.recent >= 10
      or (s.total >= 5 and s.dismissed::numeric / s.total >= 0.8)
      or (s.targets = 1 and s.total >= 4)
    )
  order by s.recent desc, s.total desc
  limit 100;
$$;

-- ── CE QUE L'ADMIN DOIT VOIR EN ARRIVANT ──
create or replace function public.moderation_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.current_role_is(array['moderator','admin'])
    then '{}'::jsonb
    else jsonb_build_object(
      'to_review', (select count(*) from public.moderation_cases
                     where status in ('open', 'needs_review')),
      'urgent',    (select count(*) from public.moderation_cases
                     where status in ('open', 'needs_review') and priority = 'urgent'),
      'appeals',   (select count(*) from public.moderation_appeals where status = 'pending'),
      'questions', (select count(*) from public.moderation_questions where answer is null),
      'suspicious_reporters', (select count(*) from public.suspicious_reporters()),
      -- Quelques indicateurs, pas un tableau de bord.
      'reports_total',    (select count(*) from public.content_reports),
      'dismissed',        (select count(*) from public.moderation_cases where status = 'dismissed'),
      'resolved',         (select count(*) from public.moderation_cases where status = 'resolved'),
      'sanctions_active', (select count(*) from public.user_sanctions
                            where lifted_at is null and (until is null or until > now())),
      'sanctions_lifted', (select count(*) from public.user_sanctions where lifted_at is not null)
    )
  end;
$$;

-- ── HISTORIQUE D'UN COMPTE, CONTEXTUALISÉ ──
-- « 5 signalements » ne veut rien dire tant qu'on ne sait pas combien ont
-- été classés sans suite. La fiche doit donner les deux.
create or replace function public.user_moderation_record(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.current_role_is(array['moderator','admin'])
    then '{}'::jsonb
    else jsonb_build_object(
      'account_age_days', (select extract(day from now() - p.created_at)::int
                             from public.profiles p where p.user_id = p_user),
      'reports_received', (select count(*) from public.content_reports r
                             where r.target_owner = p_user),
      'cases_dismissed',  (select count(*) from public.moderation_cases c
                             where c.target_owner = p_user and c.status = 'dismissed'),
      'cases_resolved',   (select count(*) from public.moderation_cases c
                             where c.target_owner = p_user and c.status = 'resolved'),
      'sanctions',        (select count(*) from public.user_sanctions s where s.user_id = p_user),
      'sanctions_lifted', (select count(*) from public.user_sanctions s
                             where s.user_id = p_user and s.lifted_at is not null),
      'appeals',          (select count(*) from public.moderation_appeals a where a.user_id = p_user)
    )
  end;
$$;

-- ── DEMANDER UNE EXPLICATION ──
create or replace function public.moderation_ask(p_case uuid, p_question text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  c public.moderation_cases;
begin
  if not public.current_role_is(array['moderator','admin']) then
    raise exception 'Accès refusé.' using hint = 'forbidden';
  end if;
  if coalesce(trim(p_question), '') = '' then
    raise exception 'La question ne peut pas être vide.' using hint = 'empty';
  end if;
  select * into c from public.moderation_cases where id = p_case;
  if c.id is null or c.target_owner is null then
    raise exception 'Dossier introuvable.' using hint = 'not_found';
  end if;

  insert into public.moderation_questions (case_id, user_id, question, asked_by)
  values (p_case, c.target_owner, trim(p_question), v_me);

  update public.moderation_cases set status = 'needs_review', updated_at = now()
   where id = p_case;

  insert into public.moderation_actions
    (case_id, actor_id, origin, action, target_user, reason)
  values (p_case, v_me, 'human', 'escalate', c.target_owner, 'Explication demandée');

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.moderation_ask(uuid, text) to authenticated;
grant execute on function public.moderation_counts() to authenticated;
grant execute on function public.suspicious_reporters() to authenticated;
grant execute on function public.user_moderation_record(uuid) to authenticated;

-- La file porte désormais la priorité. DROP d'abord : une fonction qui gagne
-- une colonne de sortie ne peut pas être remplacée par CREATE OR REPLACE.
drop function if exists public.moderation_queue(text);
create function public.moderation_queue(p_status text default 'open')
returns table (
  case_id uuid, target_type text, target_id uuid,
  target_owner uuid, owner_pseudo text, owner_avatar text,
  report_count integer, status text, risk text, bot_verdict text,
  bot_source text, reasons text[], preview text, updated_at timestamptz,
  priority text
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
    case c.target_type
      when 'spot'    then (select left(coalesce(s.brand,'') || ' ' || coalesce(s.model,''), 80) from public.spots s where s.id = c.target_id)
      when 'comment' then (select left(cm.content, 120) from public.comments cm where cm.id = c.target_id)
      when 'story'   then (select 'Story · ' || to_char(st.created_at, 'DD/MM HH24:MI') from public.stories st where st.id = c.target_id)
      when 'profile' then (select coalesce(pr.pseudo, 'Profil') from public.profiles pr where pr.user_id = c.target_id)
    end,
    c.updated_at,
    c.priority
  from public.moderation_cases c
  left join public.profiles p on p.user_id = c.target_owner
  where public.current_role_is(array['moderator','admin'])
    and (p_status = 'all'
         or (p_status = 'urgent' and c.priority = 'urgent'
             and c.status in ('open','needs_review'))
         or (p_status = 'pending' and c.status in ('open','needs_review'))
         or (p_status = 'done' and c.status in ('resolved','dismissed'))
         or c.status = p_status)
  order by
    case c.priority when 'urgent' then 0 when 'high' then 1 else 2 end,
    c.report_count desc,
    c.updated_at desc
  limit 200;
$$;

notify pgrst, 'reload schema';
