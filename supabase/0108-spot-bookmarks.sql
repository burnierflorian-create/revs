-- ═══════ 0108 — FAVORIS : SAUVEGARDER N'EST PAS AIMER ═══════
--
-- Un « j'aime » est un signal SOCIAL : il est public, il compte pour l'auteur,
-- il alimente l'XP. Un favori est une note PERSONNELLE : « je veux retrouver
-- cette voiture ». Les confondre obligerait à aimer publiquement tout ce qu'on
-- veut garder, et à perdre ce qu'on ne veut pas applaudir.
--
-- D'où une table distincte de `spot_likes`, et des règles opposées : les likes
-- sont lisibles par tous (c'est leur fonction), les favoris ne le sont que par
-- leur auteur.

create table if not exists public.spot_bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  spot_id    uuid not null references public.spots (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Deux fois le même favori n'a aucun sens, et laisserait le bouton dans un
  -- état ambigu (« retiré » alors qu'il en reste un). La contrainte le rend
  -- impossible, et l'interface s'appuie dessus plutôt que de vérifier avant
  -- d'écrire — une vérification préalable laisse toujours une course ouverte.
  unique (user_id, spot_id)
);

create index if not exists spot_bookmarks_user_idx
  on public.spot_bookmarks (user_id, created_at desc);
create index if not exists spot_bookmarks_spot_idx
  on public.spot_bookmarks (spot_id);

alter table public.spot_bookmarks enable row level security;

-- ── TROIS POLICIES, TOUTES SUR SOI ──
-- Aucune lecture croisée : personne ne peut savoir ce qu'un autre a mis de
-- côté, ni même combien. C'est une liste privée, pas un compteur social.
drop policy if exists "read own bookmarks" on public.spot_bookmarks;
create policy "read own bookmarks" on public.spot_bookmarks
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "insert own bookmarks" on public.spot_bookmarks;
create policy "insert own bookmarks" on public.spot_bookmarks
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own bookmarks" on public.spot_bookmarks;
create policy "delete own bookmarks" on public.spot_bookmarks
  for delete to authenticated using (user_id = auth.uid());

-- Pas d'UPDATE : un favori n'a rien à modifier, il existe ou il n'existe pas.
grant select, insert, delete on public.spot_bookmarks to authenticated;

comment on table public.spot_bookmarks is
  'Favoris PRIVÉS. Distincts de spot_likes : le like est social et public, le '
  'favori est une sauvegarde personnelle visible de son seul auteur.';

notify pgrst, 'reload schema';
