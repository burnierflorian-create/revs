-- ═══════════ CANDIDATURE ORGANISATEUR — DOSSIER COMPLET ═══════════
--
-- CE QUI EXISTAIT DÉJÀ (audit du 01/10/2026)
-- La migration 0002 avait posé les fondations, et elles sont bonnes :
--   · `profiles.role` ∈ (user, organizer, admin), avec contrainte ;
--   · `organizer_requests` (id, user_id, pseudo, ville, raison, created_at) ;
--   · la policy INSERT de `events` exige déjà `role in ('organizer','admin')`.
--
-- L'autorisation organisateur est donc DÉJÀ vérifiée côté serveur. Rien à
-- reconstruire de ce côté : il manquait seulement de quoi instruire un
-- dossier, et de quoi le faire changer d'état.
--
-- CE QUE CETTE MIGRATION AJOUTE
--   1. les colonnes du dossier (identité, présence, projet) ;
--   2. un `status` à trois valeurs, et rien de plus ;
--   3. la garantie qu'un utilisateur ne peut pas s'auto-approuver ;
--   4. le passage automatique au rôle `organizer` à l'approbation ;
--   5. la notification correspondante, via le système existant (0090).

-- ─────────────────────── 1. LE DOSSIER ───────────────────────
-- Un dossier doit permettre de répondre à une seule question : qui est cette
-- personne, et que veut-elle organiser ? Tout champ qui n'y contribue pas est
-- une donnée personnelle collectée pour rien.
alter table public.organizer_requests
  add column if not exists status               text not null default 'pending',
  add column if not exists first_name           text,
  add column if not exists last_name            text,
  add column if not exists display_name         text,
  add column if not exists email                text,
  add column if not exists phone                text,
  add column if not exists city_region          text,
  add column if not exists instagram_url        text,
  add column if not exists website_url          text,
  add column if not exists organization_name    text,
  add column if not exists event_types          text[] not null default '{}',
  add column if not exists experience_level     text,
  add column if not exists event_region         text,
  add column if not exists expected_attendance  text,
  add column if not exists project_description  text,
  add column if not exists consent_contact      boolean not null default false,
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists reviewed_at          timestamptz,
  add column if not exists reviewed_by          uuid references auth.users(id),
  add column if not exists review_notes         text,
  -- Trace d'envoi du courriel à l'administrateur. Elle existe pour qu'une
  -- panne du fournisseur d'e-mail soit RATTRAPABLE : un dossier enregistré
  -- mais jamais signalé reste retrouvable (scripts/organizer-notify-pending.mjs).
  add column if not exists admin_notified_at    timestamptz;

-- Trois statuts. Pas quinze : chacun doit correspondre à une décision réelle,
-- et REVS n'en prend que trois.
alter table public.organizer_requests drop constraint if exists organizer_requests_status_check;
alter table public.organizer_requests
  add constraint organizer_requests_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- ── UNE SEULE CANDIDATURE VIVANTE, MAIS TOUT L'HISTORIQUE ──
-- Index partiel : il n'interdit que les doublons ACTIFS. Un dossier refusé
-- sort de l'index, ce qui autorise une nouvelle candidature plus tard sans
-- effacer la précédente — on ne réécrit pas le passé de quelqu'un.
create unique index if not exists organizer_requests_active_idx
  on public.organizer_requests (user_id)
  where status in ('pending', 'approved');

-- La page Paramètres ne lit que LE dossier de l'utilisateur courant, le plus
-- récent. Cet index sert exactement cette requête (§38 : ne pas charger la
-- table entière pour afficher un statut).
create index if not exists organizer_requests_user_recent_idx
  on public.organizer_requests (user_id, created_at desc);

-- Retrouver les dossiers à instruire, et ceux dont l'e-mail n'est pas parti.
create index if not exists organizer_requests_pending_idx
  on public.organizer_requests (created_at desc)
  where status = 'pending';

-- ─────────────────────── 2. SÉCURITÉ ───────────────────────
alter table public.organizer_requests enable row level security;

drop policy if exists "org req insert own" on public.organizer_requests;
drop policy if exists "org req select own" on public.organizer_requests;
drop policy if exists "org req update own" on public.organizer_requests;

-- Lecture : la sienne, rien d'autre.
create policy "org req select own"
  on public.organizer_requests for select to authenticated
  using (auth.uid() = user_id);

-- Écriture : uniquement par la fonction ci-dessous. Aucune policy INSERT
-- directe — un client qui pourrait insérer lui-même pourrait écrire
-- `status = 'approved'` dans la même requête, et le déclencheur lui donnerait
-- le rôle. Le `WITH CHECK` seul ne suffirait pas à rendre cela évident ; ne
-- pas donner la permission du tout est plus simple à vérifier.
--
-- Aucune policy UPDATE ni DELETE non plus : le statut, `reviewed_by` et les
-- notes internes ne sont modifiables que par la clé de service (instruction
-- par REVS). Un utilisateur ne peut donc ni s'approuver, ni se relire.

revoke insert, update, delete on public.organizer_requests from authenticated, anon;

-- ─────────────────────── 3. DÉPÔT D'UNE CANDIDATURE ───────────────────────
-- SECURITY DEFINER : c'est la seule porte d'entrée. Elle impose ce que le
-- client ne doit pas choisir — l'utilisateur, le statut, les champs
-- d'instruction — et refuse les doublons avec un message exploitable.
create or replace function public.submit_organizer_request(
  p_first_name          text,
  p_last_name           text,
  p_display_name        text,
  p_email               text,
  p_phone               text,
  p_city_region         text,
  p_instagram_url       text,
  p_website_url         text,
  p_organization_name   text,
  p_event_types         text[],
  p_experience_level    text,
  p_event_region        text,
  p_expected_attendance text,
  p_project_description text,
  p_consent_contact     boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
  v_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select role into v_role from public.profiles where user_id = v_user;
  if v_role in ('organizer', 'admin') then
    raise exception 'already_organizer' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.organizer_requests
     where user_id = v_user and status in ('pending', 'approved')
  ) then
    raise exception 'request_already_open' using errcode = '23505';
  end if;

  -- Validation serveur. Le formulaire valide déjà côté navigateur, mais le
  -- navigateur n'est pas une autorité : cette fonction est appelable sans lui.
  if coalesce(trim(p_first_name), '') = ''
     or coalesce(trim(p_last_name), '') = ''
     or coalesce(trim(p_phone), '') = ''
     or coalesce(trim(p_city_region), '') = ''
     or coalesce(trim(p_project_description), '') = ''
     or coalesce(array_length(p_event_types, 1), 0) = 0
     or coalesce(trim(p_experience_level), '') = ''
     or p_consent_contact is not true
  then
    raise exception 'missing_required_fields' using errcode = '22023';
  end if;

  insert into public.organizer_requests (
    user_id, status, first_name, last_name, display_name, email, phone,
    city_region, instagram_url, website_url, organization_name, event_types,
    experience_level, event_region, expected_attendance, project_description,
    consent_contact,
    -- Les colonnes d'origine (0002) restent alimentées : les requêtes et le
    -- code qui les lisaient continuent de fonctionner.
    pseudo, ville, raison
  )
  values (
    v_user, 'pending',
    left(trim(p_first_name), 80), left(trim(p_last_name), 80),
    left(trim(coalesce(p_display_name, '')), 80),
    -- L'adresse vient du jeton, jamais du formulaire : c'est ce qui empêche
    -- quelqu'un de déposer un dossier sous l'identité d'un autre.
    (select email from auth.users where id = v_user),
    left(trim(p_phone), 32), left(trim(p_city_region), 120),
    nullif(left(trim(coalesce(p_instagram_url, '')), 200), ''),
    nullif(left(trim(coalesce(p_website_url, '')), 200), ''),
    nullif(left(trim(coalesce(p_organization_name, '')), 120), ''),
    p_event_types,
    left(trim(p_experience_level), 32),
    nullif(left(trim(coalesce(p_event_region, '')), 120), ''),
    nullif(left(trim(coalesce(p_expected_attendance, '')), 32), ''),
    left(trim(p_project_description), 1000),
    true,
    left(trim(coalesce(p_display_name, '')), 80),
    left(trim(p_city_region), 120),
    left(trim(p_project_description), 1000)
  )
  returning id into v_id;

  return v_id;
end
$$;

grant execute on function public.submit_organizer_request(
  text, text, text, text, text, text, text, text, text, text[],
  text, text, text, text, boolean
) to authenticated;
revoke all on function public.submit_organizer_request(
  text, text, text, text, text, text, text, text, text, text[],
  text, text, text, text, boolean
) from anon;

-- ─────────────────────── 4. LECTURE DU STATUT ───────────────────────
-- Le strict nécessaire pour que Paramètres affiche l'état : ni les notes
-- internes, ni `reviewed_by`. L'utilisateur n'a pas à voir les coulisses de
-- la décision — seulement la décision.
create or replace function public.my_organizer_request()
returns table (id uuid, status text, created_at timestamptz, reviewed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.status, r.created_at, r.reviewed_at
    from public.organizer_requests r
   where r.user_id = auth.uid()
   order by r.created_at desc
   limit 1
$$;

grant execute on function public.my_organizer_request() to authenticated;
revoke all on function public.my_organizer_request() from anon;

-- ── Trace d'envoi ──
-- Appelable par le seul propriétaire du dossier. Conséquence d'un mensonge :
-- le script de rattrapage saute sa ligne. C'est tout — il peut de toute façon
-- être relancé avec --all pour ignorer le drapeau.
create or replace function public.mark_organizer_notified(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organizer_requests
     set admin_notified_at = now()
   where id = p_id and user_id = auth.uid() and admin_notified_at is null;
  return found;
end
$$;

grant execute on function public.mark_organizer_notified(uuid) to authenticated;
revoke all on function public.mark_organizer_notified(uuid) from anon;

-- ─────────────────────── 5. LA DÉCISION ───────────────────────
-- Le cœur de la mission : « approuvé » doit donner le rôle POUR DE VRAI, pas
-- seulement changer une couleur dans l'interface.
--
-- C'est un déclencheur et non un appel applicatif, pour que l'approbation
-- fonctionne quelle que soit la porte empruntée — tableau de bord Supabase,
-- script d'administration, futur back-office. Le rôle ne peut pas diverger du
-- statut, parce que rien ne peut changer l'un sans l'autre.
create or replace function public.apply_organizer_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  new.reviewed_at := coalesce(new.reviewed_at, now());

  if new.status = 'approved' then
    -- On ne rétrograde jamais un admin en organisateur.
    update public.profiles
       set role = 'organizer'
     where user_id = new.user_id and role = 'user';

    insert into public.notifications (user_id, type, title, body, link, dedupe_key, meta)
    values (
      new.user_id, 'system',
      'Tu es organisateur REVS 🎉',
      'Ta demande a été acceptée. Tu peux désormais créer tes événements.',
      '/events', 'organizer:' || new.id::text || ':approved',
      jsonb_build_object('request_id', new.id)
    )
    on conflict (user_id, dedupe_key) do nothing;

  elsif new.status = 'rejected' then
    insert into public.notifications (user_id, type, title, body, link, dedupe_key, meta)
    values (
      new.user_id, 'system',
      'Ta demande d’organisateur a été examinée',
      'Elle n’a pas été retenue cette fois-ci. Tu pourras en déposer une nouvelle plus tard.',
      '/settings', 'organizer:' || new.id::text || ':rejected',
      jsonb_build_object('request_id', new.id)
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_organizer_decision on public.organizer_requests;
create trigger trg_organizer_decision
  before update of status on public.organizer_requests
  for each row execute function public.apply_organizer_decision();

notify pgrst, 'reload schema';
