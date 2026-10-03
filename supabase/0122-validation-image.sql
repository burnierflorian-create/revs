-- ═══════ LA RÈGLE AUTOMOBILE, APPLIQUÉE CÔTÉ SERVEUR ═══════
--
-- Une vérification côté client ne vaut rien : les spots et les stories sont
-- écrits directement par PostgREST, et n'importe qui peut appeler cette API
-- sans passer par l'application.
--
-- ── COMMENT ON FERME LA PORTE SANS TOUT RÉÉCRIRE ──
-- Le point de validation (`/api/validate-image`) est le seul à détenir la
-- clé de service. Quand il juge une image automobile, il dépose ici un jeton
-- à usage unique, nominatif et daté. Les déclencheurs sur `spots` et
-- `stories` exigent un jeton valide et le consomment.
--
-- Conséquence : publier sans passer par le contrôle est impossible, même en
-- appelant PostgREST directement — il faudrait fabriquer un jeton que seul
-- le service peut créer.
--
-- ── CE QUI N'EST PAS CONCERNÉ ──
-- L'avatar. Une photo de profil peut être n'importe quelle image : c'est le
-- visage de quelqu'un, pas un contenu REVS. `avatars` n'a aucun déclencheur.

create table if not exists public.image_validations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  verdict    text not null check (verdict in (
               'car', 'motorcycle', 'motorsport'
             )),
  -- Ce que le contrôle a vu, pour pouvoir expliquer un refus plus tard. Pas
  -- de score : un pourcentage n'a aucun sens pour qui le lit.
  note       text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by text
);
create index if not exists image_validations_user_idx
  on public.image_validations (user_id, created_at desc);

alter table public.image_validations enable row level security;

-- On voit ses propres jetons ; personne n'en crée depuis le client. Aucune
-- policy INSERT n'existe, et aucun droit INSERT n'est accordé : seul le
-- service_role, qui contourne RLS, peut en déposer un.
drop policy if exists "read own validations" on public.image_validations;
create policy "read own validations" on public.image_validations
  for select to authenticated using (auth.uid() = user_id);

grant select on public.image_validations to authenticated;

-- ── LA COLONNE QUI PORTE LE JETON ──
alter table public.spots   add column if not exists validation_id uuid;
alter table public.stories add column if not exists validation_id uuid;

-- ── LA VÉRIFICATION ──
-- Un jeton doit être : le sien, non consommé, et récent. Trente minutes
-- laissent le temps d'écrire une description sans qu'un jeton traîne
-- indéfiniment.
create or replace function public.consume_image_validation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.image_validations;
begin
  if new.validation_id is null then
    raise exception 'Image non validée.' using hint = 'validation_required';
  end if;
  select * into v from public.image_validations
   where id = new.validation_id
     and user_id = new.user_id
     and consumed_at is null
     and created_at > now() - interval '30 minutes'
   for update;
  if v.id is null then
    raise exception 'Validation d''image invalide ou expirée.'
      using hint = 'validation_invalid';
  end if;
  update public.image_validations
     set consumed_at = now(), consumed_by = tg_table_name
   where id = v.id;
  return new;
end;
$$;

-- ── ACTIVATION PROGRESSIVE ──
-- Les déclencheurs sont posés mais DÉSACTIVÉS. Les activer tout de suite
-- casserait chaque publication en cours pendant les minutes de déploiement,
-- et toute version de l'application encore ouverte sur un téléphone.
-- `scripts/image-gate.mjs` les active une fois le front déployé et vérifié.
drop trigger if exists trg_validate_spot_image on public.spots;
create trigger trg_validate_spot_image
  before insert on public.spots
  for each row execute function public.consume_image_validation();
alter table public.spots disable trigger trg_validate_spot_image;

drop trigger if exists trg_validate_story_image on public.stories;
create trigger trg_validate_story_image
  before insert on public.stories
  for each row execute function public.consume_image_validation();
alter table public.stories disable trigger trg_validate_story_image;

comment on function public.consume_image_validation() is
  'Exige un jeton de validation automobile à usage unique, délivré par '
  '/api/validate-image. Ne s''applique PAS aux avatars : une photo de profil '
  'peut être n''importe quelle image.';

notify pgrst, 'reload schema';
