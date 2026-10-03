-- ═══════ 0111 — REVS STORIES ═══════
--
-- Une photo, une légende facultative, 24 heures. Rien d'autre : pas de
-- filtres, pas de stickers, pas de musique, pas de réponses. Ce n'est pas un
-- clone — c'est le minimum qui rende la fonctionnalité réelle.
--
-- ── DEUX TABLES, PAS UNE ──
-- Le compteur de vues pourrait vivre dans une colonne de `stories`, incrémentée
-- à chaque ouverture. Mais il faudrait alors empêcher un même spectateur de la
-- gonfler en rouvrant, ce qui suppose de mémoriser qui a vu — c'est-à-dire la
-- seconde table. Autant la poser franchement : elle porte aussi l'état
-- « vu / non vu » dont le carrousel a besoin pour l'anneau rouge.

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  media_url  text not null,
  caption    text,
  -- 'public'    : visible de tous les membres.
  -- 'followers' : visible de ses abonnés (et de lui-même).
  -- La colonne existe dès maintenant parce que l'ajouter APRÈS coup
  -- obligerait à réécrire les policies sur une table déjà peuplée.
  visibility text not null default 'public' check (visibility in ('public', 'followers')),
  created_at timestamptz not null default now(),
  -- 24 h, posées à l'insertion plutôt que calculées à la lecture : une story
  -- doit pouvoir être prolongée ou raccourcie un jour sans réécrire toutes
  -- les requêtes qui la lisent.
  expires_at timestamptz not null default now() + interval '24 hours'
);

-- L'index porte sur (expires_at, created_at) : TOUTE lecture commence par
-- écarter les expirées, puis ordonne par date.
create index if not exists stories_active_idx
  on public.stories (expires_at desc, created_at desc);
create index if not exists stories_user_idx
  on public.stories (user_id, created_at desc);

create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

-- ── QUI VOIT QUOI ──
-- Une story expirée n'est lisible par personne, pas même son auteur : elle a
-- cessé d'exister pour le produit, et la laisser lisible en ferait une archive
-- qu'on n'a jamais promise.
drop policy if exists "read visible stories" on public.stories;
create policy "read visible stories" on public.stories
  for select to authenticated
  using (
    expires_at > now()
    and (
      user_id = auth.uid()
      or visibility = 'public'
      or (
        visibility = 'followers'
        and exists (
          select 1 from public.followers f
          where f.following_id = stories.user_id
            and f.follower_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "insert own stories" on public.stories;
create policy "insert own stories" on public.stories
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own stories" on public.stories;
create policy "delete own stories" on public.stories
  for delete to authenticated using (user_id = auth.uid());

-- Pas d'UPDATE : une story ne se modifie pas. On la supprime et on en repose
-- une — c'est le contrat implicite d'un contenu éphémère.

-- ── LES VUES ──
-- Chacun voit les SIENNES (pour savoir ce qu'il a déjà regardé), et l'auteur
-- voit celles de ses propres stories (c'est à cela que sert un compteur).
-- Personne d'autre : qui a regardé quoi ne regarde personne d'autre.
drop policy if exists "read own or authored views" on public.story_views;
create policy "read own or authored views" on public.story_views
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_views.story_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "insert own views" on public.story_views;
create policy "insert own views" on public.story_views
  for insert to authenticated with check (user_id = auth.uid());

grant select, insert, delete on public.stories to authenticated;
grant select, insert on public.story_views to authenticated;

-- ── LE CARROUSEL, EN UNE REQUÊTE ──
-- Le Fil a besoin, par auteur : son avatar, son pseudo, sa présence, le nombre
-- de stories actives et s'il en reste une non vue. Calculer cela côté client
-- demanderait une requête par auteur — exactement le N+1 qu'on refuse
-- ailleurs.
create or replace function public.stories_feed()
returns table (
  user_id      uuid,
  pseudo       text,
  avatar       text,
  online       boolean,
  story_count  integer,
  has_unseen   boolean,
  latest_at    timestamptz,
  is_me        boolean
)
language sql
stable
security invoker          -- les policies ci-dessus décident de la visibilité
set search_path = public
as $$
  select
    s.user_id,
    p.pseudo,
    p.avatar,
    (p.last_seen is not null and p.last_seen >= now() - interval '5 minutes') as online,
    count(*)::int as story_count,
    bool_or(v.user_id is null) as has_unseen,
    max(s.created_at) as latest_at,
    (s.user_id = auth.uid()) as is_me
  from public.stories s
  join public.profiles p on p.user_id = s.user_id
  left join public.story_views v
    on v.story_id = s.id and v.user_id = auth.uid()
  where s.expires_at > now()
  group by s.user_id, p.pseudo, p.avatar, p.last_seen
  -- Soi d'abord, puis ceux qu'on n'a pas encore vus, puis les plus récents.
  order by (s.user_id = auth.uid()) desc, bool_or(v.user_id is null) desc, max(s.created_at) desc
  limit 50;
$$;

grant execute on function public.stories_feed() to authenticated;

-- ── MÉNAGE ──
-- Les lignes expirées ne sont plus lisibles (policy ci-dessus), donc elles
-- n'apparaissent nulle part. Leur suppression physique est une tâche
-- d'entretien distincte : cette fonction existe pour qu'un cron puisse
-- l'appeler, sans qu'aucune lecture n'en dépende.
create or replace function public.purge_expired_stories()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.stories where expires_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.purge_expired_stories() is
  'Supprime les stories expirées depuis plus de 7 jours. Aucune lecture n''en '
  'dépend — les expirées sont déjà invisibles par policy. Le délai de grâce '
  'laisse le temps de diagnostiquer un incident avant que la donnée parte.';

notify pgrst, 'reload schema';
