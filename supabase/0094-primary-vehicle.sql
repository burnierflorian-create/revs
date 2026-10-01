-- ═══════════ VÉHICULE PRINCIPAL — UNE SEULE SOURCE DE VÉRITÉ ═══════════
--
-- ── LA VRAIE CAUSE DU BUG ──
-- « Mon véhicule » n'apparaissait pas chez les autres pour une raison plus
-- simple qu'une RLS ou un cache : AUCUNE surface publique ne lisait la donnée.
-- Relevé le 01/10/2026 sur les 29 lectures de `profiles` du dépôt —
-- `garage_brand` n'était demandé QUE par Paramètres. Ni Profil, ni Profil
-- public, ni Feed, ni SpotDetail ne le sélectionnaient. Rien n'était cassé :
-- la question n'était jamais posée.
--
-- ── POURQUOI UN NOUVEAU CHAMP, MALGRÉ LA CONSIGNE ──
-- Le cahier des charges dit de ne pas ajouter un champ pour contourner le
-- problème. Celui-ci ne contourne rien : `garage_brand` est un texte libre qui
-- ne porte qu'une MARQUE (« Porsche »). Le critère d'acceptation demande que
-- l'autre utilisateur voie « Ferrari 488 Pista » — un modèle, pas une marque.
-- Aucun champ existant ne peut porter cela.
--
-- `primary_spot_id` désigne un SPOT de l'utilisateur. C'est le choix le plus
-- cohérent avec REVS : « ma voiture » devient une voiture réellement
-- photographiée, et on hérite gratuitement de la marque, du modèle, de la
-- couleur, de la photo protégée et du futur Garage Visual. Aucune donnée
-- dupliquée, aucune saisie de plus.
--
-- `garage_brand` n'est PAS supprimé : il garde ses données et sert de repli
-- textuel pour qui n'a pas encore spotté sa propre voiture.

alter table public.profiles
  add column if not exists primary_spot_id uuid references public.spots(id) on delete set null;

-- ⚠️ La migration 0093 a retiré UPDATE sur `profiles` et l'a redonné colonne
-- par colonne. Une colonne ajoutée après coup naît donc en LECTURE SEULE pour
-- le client. Sans cette ligne, choisir son véhicule échouerait en « permission
-- denied » — exactement le genre de panne silencieuse que 0093 pouvait créer.
grant update (primary_spot_id) on public.profiles to authenticated;

-- ── LE SPOT DOIT APPARTENIR À CELUI QUI LE DÉSIGNE ──
-- Sans ce garde, n'importe qui pourrait afficher la Ferrari d'un autre comme
-- « son véhicule ». La RLS ne peut pas l'exprimer : elle autorise la ligne,
-- pas la valeur. Un déclencheur, si.
create or replace function public.check_primary_spot_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.primary_spot_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.spots s
     where s.id = new.primary_spot_id and s.user_id = new.user_id
  ) then
    raise exception 'primary_spot_not_owned' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_primary_spot_owner on public.profiles;
create trigger trg_primary_spot_owner
  before insert or update of primary_spot_id on public.profiles
  for each row execute function public.check_primary_spot_owner();

-- ── LECTURE PUBLIQUE ──
-- Le profil public a besoin du véhicule, et `spots` est déjà en lecture
-- publique totale — il n'y a donc rien à ouvrir. Cette vue existe pour que
-- toutes les surfaces posent la MÊME question : une seule jointure, un seul
-- jeu de colonnes, impossible d'en oublier une comme c'était le cas.
--
-- `security_invoker` : la vue applique les politiques de CELUI QUI LIT, pas
-- celles de son créateur. Sans cela elle contournerait la RLS de `profiles` et
-- exposerait les profils privés.
create or replace view public.profile_public
with (security_invoker = true)
as
  select
    p.user_id,
    p.pseudo,
    p.ville,
    p.avatar,
    p.title,
    p.instagram,
    p.dream_car,
    p.created_at,
    p.primary_spot_id,
    s.brand        as primary_brand,
    s.model        as primary_model,
    s.year         as primary_year,
    s.color        as primary_color,
    s.rarity       as primary_rarity,
    s.photo_url    as primary_photo_url,
    s.garage_render_url as primary_render_url
  from public.profiles p
  left join public.spots s
    on s.id = p.primary_spot_id and s.user_id = p.user_id;

grant select on public.profile_public to authenticated, anon;

-- ── NORMALISATION D'INSTAGRAM ──
-- Le pseudo doit être stocké sous UNE forme canonique : sans « @ », sans URL,
-- sans espace. L'affichage rajoute le « @ ». Sans cela, « @flr_brn » saisi par
-- l'utilisateur devenait « @@flr_brn » à l'écran, et le lien pointait vers
-- instagram.com/@flr_brn — une page qui n'existe pas.
--
-- Le faire en base plutôt qu'au formulaire couvre TOUS les chemins d'écriture,
-- y compris ceux qu'on ajoutera plus tard.
create or replace function public.normalize_social_handles()
returns trigger
language plpgsql
as $$
begin
  if new.instagram is not null then
    new.instagram := nullif(
      regexp_replace(
        regexp_replace(lower(trim(new.instagram)),
          '^(https?://)?(www\.)?instagram\.com/', ''),
        '^@+|/.*$|\s', '', 'g'),
      '');
  end if;
  if new.tiktok is not null then
    new.tiktok := nullif(
      regexp_replace(
        regexp_replace(lower(trim(new.tiktok)),
          '^(https?://)?(www\.)?tiktok\.com/', ''),
        '^@+|/.*$|\s', '', 'g'),
      '');
  end if;
  return new;
end
$$;

drop trigger if exists trg_normalize_social on public.profiles;
create trigger trg_normalize_social
  before insert or update of instagram, tiktok on public.profiles
  for each row execute function public.normalize_social_handles();

-- Rattrapage des valeurs déjà enregistrées sous une forme non canonique.
update public.profiles
   set instagram = instagram
 where instagram is not null
   and instagram <> regexp_replace(
         regexp_replace(lower(trim(instagram)), '^(https?://)?(www\.)?instagram\.com/', ''),
         '^@+|/.*$|\s', '', 'g');

notify pgrst, 'reload schema';
