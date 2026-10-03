-- ═══════ MODÉRATION REVS — RÔLES, SIGNALEMENTS, BLOCAGES, SANCTIONS ═══════
--
-- ── D'ABORD, DEUX TROUS À FERMER ──
-- La policy UPDATE de `profiles` autorise un compte à modifier TOUTE colonne
-- de sa propre ligne. Vérifié sur un compte jetable :
--
--     un utilisateur peut-il se nommer admin ? → OUI
--     peut-il se donner de l'XP ?             → OUI
--
-- Le premier rend inutile tout panneau d'administration fondé sur un rôle :
-- n'importe qui s'y nommerait. Le second rend l'économie XP forgeable.
--
-- La correction n'est pas une policy de plus — une policy raisonne par
-- LIGNE, pas par colonne. Postgres sait restreindre les colonnes : on retire
-- l'UPDATE global et on le réaccorde colonne par colonne. Les fonctions
-- SECURITY DEFINER s'exécutent sous le propriétaire de la table et gardent
-- donc tous leurs droits — `award_xp_spot`, `bump_xp_total` et
-- `bump_last_seen` continuent d'écrire ce qu'elles doivent écrire.

revoke update on public.profiles from authenticated;

grant update (
  pseudo, ville, country, language, avatar, dream_car, instagram, tiktok,
  is_public, onboarding_completed, tutorial_completed, age_confirmed,
  interests, preferred_brands, preferred_universes, discovery_source,
  ambition, garage_brand, primary_spot_id, force_relogin, updated_at
) on public.profiles to authenticated;

-- Hors de cette liste, et donc désormais inaccessibles au client :
--   role               — sinon, auto-promotion en administrateur
--   xp_total, prestige, prestige_xp_base — l'économie XP
--   title              — décerné par award_xp_spot(), pas choisi
--   tier               — le niveau d'abonnement
--   invite_code        — généré par déclencheur
--   last_seen          — écrit par bump_last_seen(), jamais à la main

-- ── LES RÔLES ──
-- `profiles.role` existe déjà (texte, défaut 'user'). On le contraint plutôt
-- que de créer une table de plus : une table `user_roles` à une ligne par
-- compte serait une jointure supplémentaire sur chaque vérification, pour
-- exactement la même information.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'beta_tester', 'moderator', 'admin'));

create or replace function public.current_role_is(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = any(p_roles)
  );
$$;

comment on function public.current_role_is(text[]) is
  'Le rôle de l''appelant est-il dans cette liste ? Toutes les policies de '
  'modération passent par ici — aucune n''interroge une adresse e-mail.';

-- ── BLOCAGES ──
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Se bloquer soi-même ferait disparaître ses propres publications.
  constraint no_self_block check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "read own blocks" on public.user_blocks;
create policy "read own blocks" on public.user_blocks
  for select to authenticated using (auth.uid() = blocker_id);

drop policy if exists "block as self" on public.user_blocks;
create policy "block as self" on public.user_blocks
  for insert to authenticated with check (auth.uid() = blocker_id);

drop policy if exists "unblock as self" on public.user_blocks;
create policy "unblock as self" on public.user_blocks
  for delete to authenticated using (auth.uid() = blocker_id);

grant select, insert, delete on public.user_blocks to authenticated;

-- Qui ne doit plus m'apparaître : ceux que j'ai bloqués, ET ceux qui m'ont
-- bloqué. Le second sens compte autant — sans lui, la personne bloquée
-- continue de voir et de commenter celle qui l'a bloquée, et le blocage ne
-- protège personne.
create or replace function public.is_hidden_from_me(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_author is not null and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_author)
       or (b.blocker_id = p_author and b.blocked_id = auth.uid())
  );
$$;

-- ── SANCTIONS ──
-- Une ligne par sanction, jamais écrasée : l'historique d'un compte est la
-- suite de ses sanctions. `active` est dérivé de `until` et de `lifted_at`
-- plutôt que stocké — un drapeau stocké finit toujours par mentir.
create table if not exists public.user_sanctions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in (
                'warning', 'content_removed', 'restricted',
                'suspended', 'banned'
              )),
  reason      text not null,
  -- null = sans échéance (avertissement, bannissement).
  until       timestamptz,
  issued_by   uuid references auth.users (id) on delete set null,
  -- 'auto' seulement pour les mesures réversibles et peu graves ; toute
  -- sanction lourde porte l'identifiant d'un humain.
  origin      text not null default 'human' check (origin in ('auto', 'human')),
  case_id     uuid,
  lifted_at   timestamptz,
  lifted_by   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists user_sanctions_user_idx on public.user_sanctions (user_id, created_at desc);

alter table public.user_sanctions enable row level security;

-- On voit ses propres sanctions — il faut bien pouvoir les contester. On ne
-- voit jamais celles des autres.
drop policy if exists "read own sanctions" on public.user_sanctions;
create policy "read own sanctions" on public.user_sanctions
  for select to authenticated
  using (auth.uid() = user_id or public.current_role_is(array['moderator','admin']));

grant select on public.user_sanctions to authenticated;

create or replace function public.active_sanction(p_user uuid)
returns table (kind text, reason text, until timestamptz, id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.kind, s.reason, s.until, s.id
  from public.user_sanctions s
  where s.user_id = p_user
    and s.lifted_at is null
    and (s.until is null or s.until > now())
    and s.kind in ('restricted', 'suspended', 'banned')
  order by s.created_at desc
  limit 1;
$$;

-- ── SIGNALEMENTS ──
-- Une table pour les quatre cibles. `spot_reports` (migration 0117) ne
-- couvrait que les spots et n'a jamais reçu une seule ligne : on la remplace
-- plutôt que d'en maintenir deux.
drop table if exists public.spot_reports;

create table if not exists public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('spot', 'comment', 'story', 'profile')),
  target_id    uuid not null,
  -- Dénormalisé à l'écriture : l'auteur du contenu doit rester connu même
  -- après la suppression du contenu, sinon un dossier de modération perd son
  -- sujet au moment précis où on en a besoin.
  target_owner uuid references auth.users (id) on delete set null,
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  reason       text not null check (reason in (
                 'spam', 'harassment', 'inappropriate', 'violent',
                 'scam', 'fake_account', 'misleading_car', 'other'
               )),
  note         text,
  created_at   timestamptz not null default now(),
  -- Un signalement par personne et par contenu. Signaler cinquante fois le
  -- même spot est impossible par construction, sans aucun code de garde.
  unique (target_type, target_id, reporter_id)
);
create index if not exists content_reports_target_idx
  on public.content_reports (target_type, target_id);
create index if not exists content_reports_reporter_idx
  on public.content_reports (reporter_id, created_at desc);

alter table public.content_reports enable row level security;

-- On ne lit que ses propres signalements. Même l'auteur du contenu ne sait
-- pas qui l'a signalé — sans quoi signaler reviendrait à se désigner.
drop policy if exists "read own reports" on public.content_reports;
create policy "read own reports" on public.content_reports
  for select to authenticated
  using (auth.uid() = reporter_id or public.current_role_is(array['moderator','admin']));

drop policy if exists "report as self" on public.content_reports;
create policy "report as self" on public.content_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

grant select, insert on public.content_reports to authenticated;

-- ── DOSSIERS ──
-- Un dossier par contenu signalé, pas par signalement : dix personnes qui
-- signalent le même spot produisent un seul dossier à dix voix.
create table if not exists public.moderation_cases (
  id            uuid primary key default gen_random_uuid(),
  target_type   text not null,
  target_id     uuid not null,
  target_owner  uuid references auth.users (id) on delete set null,
  report_count  integer not null default 0,
  status        text not null default 'open' check (status in (
                  'open', 'needs_review', 'resolved', 'dismissed'
                )),
  -- Verdict automatique. `risk` et `confidence` ne sortent JAMAIS vers le
  -- public : ils ne servent qu'à décider qui tranche.
  risk          text check (risk in ('low', 'medium', 'high')),
  confidence    numeric(3, 2) check (confidence between 0 and 1),
  bot_verdict   text,
  bot_source    text check (bot_source in ('rules', 'ai')),
  bot_at        timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (target_type, target_id)
);
create index if not exists moderation_cases_status_idx
  on public.moderation_cases (status, updated_at desc);

alter table public.moderation_cases enable row level security;

drop policy if exists "moderators read cases" on public.moderation_cases;
create policy "moderators read cases" on public.moderation_cases
  for select to authenticated using (public.current_role_is(array['moderator','admin']));

grant select on public.moderation_cases to authenticated;

-- ── JOURNAL DES ACTIONS ──
-- En ajout seul. Aucune policy UPDATE ni DELETE n'existe, et aucun droit
-- correspondant n'est accordé : un journal qu'on peut réécrire ne prouve
-- rien.
create table if not exists public.moderation_actions (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid references public.moderation_cases (id) on delete set null,
  actor_id    uuid references auth.users (id) on delete set null,
  origin      text not null check (origin in ('auto', 'human')),
  action      text not null check (action in (
                'dismiss', 'hide_content', 'delete_content', 'warn',
                'restrict', 'suspend', 'ban', 'delete_account',
                'escalate', 'lift_sanction', 'appeal_accepted',
                'appeal_rejected'
              )),
  target_type text,
  target_id   uuid,
  target_user uuid references auth.users (id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists moderation_actions_case_idx
  on public.moderation_actions (case_id, created_at desc);

alter table public.moderation_actions enable row level security;

drop policy if exists "moderators read actions" on public.moderation_actions;
create policy "moderators read actions" on public.moderation_actions
  for select to authenticated using (public.current_role_is(array['moderator','admin']));

grant select on public.moderation_actions to authenticated;

-- ── CONTESTATIONS ──
create table if not exists public.moderation_appeals (
  id          uuid primary key default gen_random_uuid(),
  sanction_id uuid not null references public.user_sanctions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  message     text not null check (length(trim(message)) between 10 and 2000),
  status      text not null default 'pending' check (status in (
                'pending', 'reviewing', 'accepted', 'rejected'
              )),
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz,
  decision_note text,
  created_at  timestamptz not null default now(),
  -- Une contestation par sanction : on conteste une décision, on ne la
  -- conteste pas douze fois.
  unique (sanction_id)
);

alter table public.moderation_appeals enable row level security;

drop policy if exists "read own appeals" on public.moderation_appeals;
create policy "read own appeals" on public.moderation_appeals
  for select to authenticated
  using (auth.uid() = user_id or public.current_role_is(array['moderator','admin']));

drop policy if exists "appeal own sanction" on public.moderation_appeals;
create policy "appeal own sanction" on public.moderation_appeals
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.user_sanctions s
      where s.id = sanction_id and s.user_id = auth.uid()
    )
  );

grant select, insert on public.moderation_appeals to authenticated;

-- ═══════ SIGNALER : UNE SEULE PORTE ═══════
--
-- SECURITY DEFINER parce que la fonction fait trois choses que l'appelant
-- n'a pas le droit de faire seul : résoudre l'auteur du contenu, créer ou
-- incrémenter un dossier, et appliquer une limite d'usage. Elle n'accepte
-- que `auth.uid()` comme signaleur — on ne peut pas signaler au nom d'un
-- autre.
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
  v_recent integer;
  v_case  uuid;
  v_count integer;
begin
  if v_me is null then
    raise exception 'Connexion requise.' using hint = 'auth_required';
  end if;

  -- ── LIMITE D'USAGE ──
  -- Vingt signalements par jour. Assez pour une soirée de ménage sincère,
  -- trop peu pour harceler quelqu'un à coups de dossiers. La contrainte
  -- d'unicité empêche déjà de viser cinquante fois le même contenu ; celle-ci
  -- empêche d'en viser cinquante différents.
  select count(*) into v_recent
    from public.content_reports r
   where r.reporter_id = v_me and r.created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'Trop de signalements aujourd''hui.' using hint = 'rate_limited';
  end if;

  -- Auteur du contenu, selon sa nature.
  v_owner := case p_target_type
    when 'spot'    then (select s.user_id from public.spots s where s.id = p_target_id)
    when 'comment' then (select c.user_id from public.comments c where c.id = p_target_id)
    when 'story'   then (select st.user_id from public.stories st where st.id = p_target_id)
    when 'profile' then p_target_id
  end;
  if v_owner is null then
    raise exception 'Contenu introuvable.' using hint = 'not_found';
  end if;
  if v_owner = v_me then
    raise exception 'On ne signale pas son propre contenu.' using hint = 'self_report';
  end if;

  insert into public.content_reports
    (target_type, target_id, target_owner, reporter_id, reason, note)
  values (p_target_type, p_target_id, v_owner, v_me, p_reason, nullif(trim(p_note), ''))
  on conflict (target_type, target_id, reporter_id) do nothing;

  select count(*) into v_count
    from public.content_reports r
   where r.target_type = p_target_type and r.target_id = p_target_id;

  insert into public.moderation_cases
    (target_type, target_id, target_owner, report_count, status)
  values (p_target_type, p_target_id, v_owner, v_count, 'open')
  on conflict (target_type, target_id) do update
    set report_count = v_count,
        updated_at = now(),
        -- Un dossier déjà classé qui reçoit un nouveau signalement se
        -- rouvre : la décision précédente portait sur ce qu'on savait alors.
        status = case when public.moderation_cases.status in ('resolved', 'dismissed')
                      then 'open' else public.moderation_cases.status end
  returning id into v_case;

  return jsonb_build_object('case_id', v_case, 'reports', v_count);
end;
$$;

revoke all on function public.report_content(text, uuid, text, text) from public;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;

-- ═══════ LES BLOCAGES MASQUENT LE CONTENU PARTOUT ═══════
--
-- Posé dans les policies de lecture plutôt que dans les requêtes du client :
-- une condition oubliée dans un seul écran suffirait sinon à faire
-- réapparaître quelqu'un qu'on a bloqué. Ici, le Fil, la carte, le détail
-- d'un spot, les profils et les commentaires l'appliquent sans le savoir.
drop policy if exists "spots public read" on public.spots;
create policy "spots public read" on public.spots
  for select using (not public.is_hidden_from_me(user_id));

drop policy if exists "comments public read" on public.comments;
create policy "comments public read" on public.comments
  for select using (not public.is_hidden_from_me(user_id));

notify pgrst, 'reload schema';
