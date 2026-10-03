-- ═══════ SIGNALER UNE PUBLICATION ═══════
--
-- Le menu « … » propose « Signaler ». Un bouton qui affiche un message de
-- remerciement sans rien écrire nulle part est un décor : la mission interdit
-- explicitement de livrer une fonctionnalité qui n'en est pas une.
--
-- Cette table est volontairement minuscule. Pas de modération automatique,
-- pas de seuil de masquage, pas de notification : décider ce qu'on fait d'un
-- signalement est une question de produit, pas de schéma. Ce qui est garanti
-- ici, c'est que le signalement EXISTE et qu'il est consultable.
create table if not exists public.spot_reports (
  spot_id     uuid not null references public.spots (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason      text not null check (reason in ('inappropriate', 'spam', 'wrong_info', 'other')),
  created_at  timestamptz not null default now(),
  -- Un signalement par personne et par publication : signaler dix fois ne
  -- doit pas peser dix fois.
  primary key (spot_id, reporter_id)
);

alter table public.spot_reports enable row level security;

-- Personne ne lit les signalements des autres — ni l'auteur du spot, qui
-- saurait sinon qui l'a signalé. Seul le service_role (donc l'administration)
-- voit l'ensemble, et il contourne RLS par nature.
drop policy if exists "read own reports" on public.spot_reports;
create policy "read own reports" on public.spot_reports
  for select to authenticated using (auth.uid() = reporter_id);

drop policy if exists "report as self" on public.spot_reports;
create policy "report as self" on public.spot_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

grant select, insert on public.spot_reports to authenticated;

notify pgrst, 'reload schema';
