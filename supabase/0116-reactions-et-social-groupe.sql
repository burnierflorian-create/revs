-- ═══════ RÉACTIONS, ET UNE SEULE REQUÊTE POUR TOUT L'ÉTAT SOCIAL ═══════
--
-- ── LE PROBLÈME DE CHARGE ──
-- Chaque carte du Fil posait quatre requêtes en se montant : le nombre de
-- likes, mon like, le nombre de commentaires, mon favori. Dix cartes à
-- l'écran faisaient donc quarante allers-retours, puis quarante de plus au
-- défilement suivant. C'est le N+1 que la mission interdit.
--
-- `spot_social(uuid[])` répond pour une page entière d'un coup. Le Fil
-- l'appelle une fois par lot et distribue le résultat aux cartes, qui ne
-- parlent plus à la base que lorsqu'on les touche.
--
-- ── RÉACTIONS : POURQUOI ❤️ N'EST PAS DEDANS ──
-- La référence montre cinq émojis : ❤️ 🔥 👌 😍 😂. Le cœur existe déjà, à un
-- centimètre de là, sous la forme du bouton Like — qui porte le compteur
-- public et déclenche l'XP. Stocker un « ❤️ » ici en ferait un second cœur,
-- avec son propre compteur, à côté du premier : deux nombres pour le même
-- geste, qui finiraient par diverger.
--
-- Le cœur du sélecteur bascule donc le Like. Les quatre autres vivent ici.
-- Un membre peut aimer ET réagir — ce sont deux gestes différents.

create table if not exists public.spot_reactions (
  spot_id    uuid not null references public.spots (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  emoji      text not null check (emoji in ('🔥', '👌', '😍', '😂')),
  created_at timestamptz not null default now(),
  -- Une réaction par personne et par spot. Changer d'avis est un UPDATE, pas
  -- une seconde ligne : la clé primaire rend le double comptage impossible
  -- sans aucun code pour l'empêcher.
  primary key (spot_id, user_id)
);

create index if not exists spot_reactions_spot_idx on public.spot_reactions (spot_id);

alter table public.spot_reactions enable row level security;

drop policy if exists "reactions public read" on public.spot_reactions;
create policy "reactions public read" on public.spot_reactions
  for select using (true);

drop policy if exists "react as self" on public.spot_reactions;
create policy "react as self" on public.spot_reactions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "change own reaction" on public.spot_reactions;
create policy "change own reaction" on public.spot_reactions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "remove own reaction" on public.spot_reactions;
create policy "remove own reaction" on public.spot_reactions
  for delete to authenticated using (auth.uid() = user_id);

grant select on public.spot_reactions to anon, authenticated;
grant insert, update, delete on public.spot_reactions to authenticated;

-- ── L'ÉTAT SOCIAL D'UNE PAGE, EN UN APPEL ──
-- SECURITY INVOKER : les favoris restent privés par la policy de
-- `spot_bookmarks` (« read own bookmarks »), donc `bookmarked` ne peut
-- renvoyer vrai que pour l'appelant. Une fonction DEFINER ici aurait
-- contourné cette policy et exposé les favoris de tout le monde.
create or replace function public.spot_social(p_ids uuid[])
returns table (
  spot_id uuid,
  like_count integer,
  comment_count integer,
  reaction_count integer,
  liked boolean,
  bookmarked boolean,
  my_reaction text,
  reactions jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id as spot_id,
    coalesce(l.n, 0)::int,
    coalesce(c.n, 0)::int,
    coalesce(r.n, 0)::int,
    (ml.user_id is not null),
    (b.user_id is not null),
    mr.emoji,
    coalesce(r.breakdown, '{}'::jsonb)
  from unnest(p_ids) as s(id)
  left join (
    select sl.spot_id, count(*)::int as n
      from public.spot_likes sl where sl.spot_id = any(p_ids) group by sl.spot_id
  ) l on l.spot_id = s.id
  left join (
    select cm.spot_id, count(*)::int as n
      from public.comments cm where cm.spot_id = any(p_ids) group by cm.spot_id
  ) c on c.spot_id = s.id
  left join (
    select sr.spot_id, count(*)::int as n,
           jsonb_object_agg(sr.emoji, sr.k) as breakdown
      from (
        select spot_id, emoji, count(*)::int as k
          from public.spot_reactions where spot_id = any(p_ids)
          group by spot_id, emoji
      ) sr
      group by sr.spot_id
  ) r on r.spot_id = s.id
  left join public.spot_likes ml on ml.spot_id = s.id and ml.user_id = auth.uid()
  left join public.spot_bookmarks b on b.spot_id = s.id and b.user_id = auth.uid()
  left join public.spot_reactions mr on mr.spot_id = s.id and mr.user_id = auth.uid();
$$;

comment on function public.spot_social(uuid[]) is
  'Likes, commentaires, réactions, mon like, mon favori et ma réaction pour '
  'une page entière de spots. Remplace quatre requêtes par carte.';

-- ── DOUBLONS DE POLICIES SUR spot_likes ──
-- Six policies pour trois opérations : les trois anciennes, en {public},
-- faisaient doublon exact avec les trois actuelles en {authenticated}. Des
-- policies permissives s'additionnent, donc le comportement était déjà celui
-- des plus larges — mais six règles à relire pour trois décisions, c'est six
-- occasions de se tromper le jour où l'une change.
drop policy if exists "Users can read likes" on public.spot_likes;
drop policy if exists "Users can manage own likes" on public.spot_likes;
drop policy if exists "Users can delete own likes" on public.spot_likes;

notify pgrst, 'reload schema';
