-- ════════════════════════════════════════════════════════════════════════
--  0072 — Âge minimum : 15 ans
-- ════════════════════════════════════════════════════════════════════════
--
-- Décision produit du 29/09/2026 : l'âge minimum pour REVS est 15 ans, seuil
-- au-delà duquel un mineur peut consentir seul au traitement de ses données
-- en France (art. 45 de la loi Informatique et Libertés).
--
-- ── POURQUOI UN BOOLÉEN ET PAS UNE DATE DE NAISSANCE ──
-- Une date de naissance permettrait de recalculer l'âge dans le temps, mais
-- c'est une donnée personnelle supplémentaire, collectée pour un usage
-- unique : franchir un seuil. Le principe de minimisation commande de ne
-- garder que le résultat, pas la donnée qui y mène. On stocke donc une
-- déclaration, rien d'autre.
--
-- Ce n'est PAS une vérification d'identité, et cela ne prétend pas en être
-- une : c'est une déclaration sur l'honneur, comme sur la quasi-totalité des
-- services grand public.

alter table public.profiles
  add column if not exists age_confirmed boolean not null default false;

comment on column public.profiles.age_confirmed is
  'Déclaration « j''ai 15 ans ou plus », recueillie à l''inscription. Aucune date de naissance n''est stockée.';

-- ── Application côté serveur ──
--
-- Un simple champ rempli par le client serait contournable : il suffirait de
-- ne pas l'envoyer. Le déclencheur refuse donc toute création de profil sans
-- la déclaration.
--
-- BEFORE INSERT uniquement : les comptes existants ne sont pas touchés. Leur
-- `age_confirmed` reste à false, et c'est volontaire — les faire mentir
-- rétroactivement n'aurait aucune valeur. Leur régularisation est une
-- décision produit distincte (relance à la prochaine connexion, par exemple).
create or replace function public.require_age_confirmed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.age_confirmed is not true then
    raise exception 'Âge minimum non confirmé.'
      using hint = 'age_not_confirmed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_age_confirmed on public.profiles;
create trigger trg_require_age_confirmed
  before insert on public.profiles
  for each row execute function public.require_age_confirmed();
