-- ═══════════ NOTIFICATIONS IN-APP + NOUVEAUTÉS PRODUIT ═══════════
--
-- CE QUI EXISTAIT
-- Uniquement du PUSH : `push_subscriptions` (2 abonnements, 1 seul utilisateur)
-- et `notification_prefs`. Aucune notification consultable DANS l'application —
-- si le navigateur ne l'affichait pas, ou si l'utilisateur avait refusé les
-- notifications système, l'information était perdue sans trace.
--
-- C'est pour cette raison que la cloche avait été retirée de l'accueil le
-- 29/09 : elle n'aurait mené nulle part.
--
-- Deux tables, deux rôles distincts :
--   · `notifications`    — ce qui arrive à UNE personne (like, badge, suivi…)
--   · `product_updates`  — ce que REVS annonce à TOUT LE MONDE (changelog)
--
-- Les mélanger aurait obligé à dupliquer chaque nouveauté produit sur chaque
-- utilisateur. À 17 comptes c'est indolore ; à 17 000 c'est une table qui
-- gonfle pour rien. Le changelog est donc global, et son état « lu » vit dans
-- une petite table de liaison.

-- ─────────────────────── 1. NOTIFICATIONS PERSONNELLES ───────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Type ouvert volontairement : le catalogue évoluera (spot_highlight,
  -- event…). Une contrainte enum obligerait une migration à chaque ajout.
  type        text not null,
  title       text not null,
  body        text,
  /** Route interne à ouvrir au clic. NULL = notification non cliquable. */
  link        text,
  /** Vignette optionnelle (photo du spot, artwork du badge…). */
  image_url   text,
  /** Contexte libre : id du spot, slug du badge, auteur… */
  meta        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Le fil se lit toujours « les miennes, les plus récentes d'abord ».
create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

-- Le compteur de la cloche ne lit QUE les non-lues : index partiel, il ne
-- grossit pas avec l'historique déjà consulté.
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- ── Anti-doublon ──
-- Une même cause ne doit pas produire deux notifications : un like retiré puis
-- remis, un badge recalculé, un envoi global relancé par erreur. `dedupe_key`
-- porte cette identité (ex. `badge:premier-spot`, `update:2026-09-30`).
alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;

-- Lecture : les siennes, rien d'autre.
drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select using (auth.uid() = user_id);

-- Mise à jour : uniquement pour marquer comme lu. Aucune policy INSERT ni
-- DELETE — seul le service_role écrit. Laisser un client créer ses propres
-- notifications reviendrait à le laisser s'auto-décerner des badges.
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ─────────────────────── 2. NOUVEAUTÉS PRODUIT ───────────────────────
create table if not exists public.product_updates (
  id           text primary key,
  title_fr     text not null,
  title_en     text not null,
  body_fr      text not null,
  body_en      text not null,
  /** Puces détaillées, une liste par langue. */
  points_fr    text[] not null default '{}',
  points_en    text[] not null default '{}',
  category     text not null default 'feature',
  image_url    text,
  published_at date not null default current_date,
  /** Ordre d'affichage à date égale. Plus grand = plus haut. */
  rank         int not null default 0,
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.product_updates enable row level security;

drop policy if exists product_updates_read on public.product_updates;
create policy product_updates_read on public.product_updates
  for select using (published = true);

-- ── État « lu » par utilisateur ──
-- Une ligne par (utilisateur, nouveauté) plutôt qu'une notification dupliquée :
-- la pastille « NOUVEAU » disparaît sans faire grossir le fil personnel.
create table if not exists public.product_update_reads (
  user_id   uuid not null references auth.users(id) on delete cascade,
  update_id text not null references public.product_updates(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (user_id, update_id)
);

alter table public.product_update_reads enable row level security;

drop policy if exists pur_own on public.product_update_reads;
create policy pur_own on public.product_update_reads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────── 3. LECTURE DU COMPTEUR ───────────────────────
-- Le compteur de la cloche additionne les deux sources : les notifications
-- personnelles non lues ET les nouveautés jamais consultées.
create or replace function public.my_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.notifications
      where user_id = auth.uid() and read_at is null)
  + (select count(*) from public.product_updates pu
      where pu.published
        and not exists (
          select 1 from public.product_update_reads r
           where r.user_id = auth.uid() and r.update_id = pu.id))
$$;

-- ─────────────────────── 4. TOUT MARQUER COMME LU ───────────────────────
-- En une seule instruction, côté serveur : marquer 50 notifications une par
-- une depuis le client laisserait la cloche allumée en cas de coupure au
-- milieu.
create or replace function public.mark_all_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;

  insert into public.product_update_reads (user_id, update_id)
  select auth.uid(), pu.id from public.product_updates pu where pu.published
  on conflict do nothing;

  return n;
end
$$;

grant execute on function public.my_unread_count() to authenticated;
grant execute on function public.mark_all_read()  to authenticated;
revoke all on function public.my_unread_count() from anon;
revoke all on function public.mark_all_read()   from anon;

notify pgrst, 'reload schema';

-- ─────────── Correctif : l'index anti-doublon doit être TOTAL ───────────
-- Il était partiel (`where dedupe_key is not null`). `ON CONFLICT
-- (user_id, dedupe_key)` ne peut pas s'appuyer sur un index partiel sans en
-- répéter le prédicat, ce que PostgREST ne sait pas faire — l'insertion
-- groupée échouait avec 42P10.
--
-- Le rendre total est sans danger : en Postgres, deux NULL ne se heurtent
-- jamais dans un index unique. Les notifications personnelles (like, suivi…)
-- gardent `dedupe_key` à NULL et peuvent donc se répéter autant que de besoin,
-- tandis que les envois groupés restent uniques par destinataire.
drop index if exists public.notifications_dedupe_idx;
create unique index if not exists notifications_dedupe_idx
  on public.notifications (user_id, dedupe_key);

notify pgrst, 'reload schema';
