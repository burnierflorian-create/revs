-- ═══════════ FICHES MARQUES — CONTENU GÉNÉRÉ UNE SEULE FOIS ═══════════
--
-- ── CE QUI EXISTAIT, ET QU'ON GARDE ──
-- `brand_descriptions` (19 lignes) stockait déjà une description libre par
-- marque, et `api/brand-description.ts` faisait déjà « cache sinon génère ».
-- Le principe était bon. Trois choses manquaient :
--   1. la LANGUE — une seule description, donc l'anglais réutilisait du
--      français ou déclenchait une régénération qui écrasait l'autre ;
--   2. la STRUCTURE — un bloc de texte ne permet ni chronologie, ni modèles
--      emblématiques, ni faits marquants ;
--   3. le VERROU — deux utilisateurs ouvrant Alpine à la même seconde
--      lançaient deux générations payantes pour un seul résultat.
--
-- On étend donc la table existante. Pas de table parallèle : les 19 lignes
-- déjà payées sont conservées et deviennent les lignes françaises.

alter table public.brand_descriptions
  add column if not exists lang            text not null default 'fr',
  add column if not exists summary         text,
  add column if not exists founded_year    int,
  add column if not exists founder         text,
  add column if not exists origin_country  text,
  add column if not exists history         text,
  -- Tableaux structurés plutôt que du texte à découper à l'affichage : le
  -- client ne doit jamais avoir à deviner où commence une période.
  add column if not exists key_moments     jsonb not null default '[]'::jsonb,
  add column if not exists innovations     jsonb not null default '[]'::jsonb,
  add column if not exists iconic_models   jsonb not null default '[]'::jsonb,
  add column if not exists facts           jsonb not null default '[]'::jsonb,
  add column if not exists sources         jsonb not null default '[]'::jsonb,
  -- `content_version` permet une actualisation éditoriale FUTURE sans
  -- toucher aux lignes existantes : on incrémente la version attendue côté
  -- serveur, et seules les marques en retard sont régénérées. Jamais par un
  -- utilisateur qui ouvre une page.
  add column if not exists content_version int not null default 1,
  -- 'ready' | 'pending' | 'failed'. `pending` est le verrou : il existe
  -- pendant la génération et empêche la seconde.
  add column if not exists status          text not null default 'ready',
  add column if not exists claimed_at      timestamptz,
  add column if not exists updated_at      timestamptz not null default now();

alter table public.brand_descriptions drop constraint if exists brand_descriptions_status_check;
alter table public.brand_descriptions
  add constraint brand_descriptions_status_check
  check (status in ('pending', 'ready', 'failed'));

-- ── La clé devient (marque, langue) ──
-- Les 19 lignes existantes sont du français : le `default 'fr'` les a déjà
-- étiquetées, la bascule de clé est donc sans perte.
alter table public.brand_descriptions drop constraint if exists brand_descriptions_pkey;
alter table public.brand_descriptions
  add constraint brand_descriptions_pkey primary key (brand, lang);

-- Lecture publique : une fiche marque est du contenu éditorial, pas une
-- donnée personnelle. L'écriture reste réservée à la clé de service.
alter table public.brand_descriptions enable row level security;
drop policy if exists "brand desc public read" on public.brand_descriptions;
create policy "brand desc public read"
  on public.brand_descriptions for select using (true);
revoke insert, update, delete on public.brand_descriptions from authenticated, anon;

-- ─────────────────── LE VERROU DE GÉNÉRATION ───────────────────
--
-- Le scénario à empêcher : A ouvre Alpine, B l'ouvre deux secondes après, et
-- deux générations payantes partent pour un seul résultat.
--
-- `INSERT … ON CONFLICT DO UPDATE … WHERE` est atomique : une seule
-- transaction peut faire passer la ligne en `pending`. Les autres ne
-- modifient rien, et la clause RETURNING ne leur renvoie donc rien — c'est
-- ainsi qu'elles apprennent qu'elles ont perdu, sans verrou applicatif.
--
-- Trois réponses possibles :
--   'ready'   → le contenu est là, à jour : AUCUN appel IA ;
--   'claimed' → c'est à toi de générer ;
--   'pending' → quelqu'un d'autre génère, patiente et relis.
create or replace function public.claim_brand_content(
  p_brand   text,
  p_lang    text,
  p_version int default 1
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_got boolean := false;
begin
  -- Contenu déjà prêt et à la bonne version → rien à faire.
  if exists (
    select 1 from public.brand_descriptions
     where brand = p_brand and lang = p_lang
       and status = 'ready' and content_version >= p_version
  ) then
    return 'ready';
  end if;

  insert into public.brand_descriptions (brand, lang, status, claimed_at, content_version)
  values (p_brand, p_lang, 'pending', now(), p_version)
  on conflict (brand, lang) do update
     set status = 'pending', claimed_at = now()
   where brand_descriptions.status <> 'pending'
      -- Garde-fou : une génération abandonnée (processus tué, fonction
      -- expirée) laisserait la marque bloquée pour toujours. Au-delà de
      -- deux minutes, le verrou est considéré comme perdu et reprenable.
      or brand_descriptions.claimed_at < now() - interval '2 minutes';

  get diagnostics v_got = row_count;
  return case when v_got then 'claimed' else 'pending' end;
end
$$;

grant execute on function public.claim_brand_content(text, text, int) to authenticated, anon;

-- Lecture du contenu d'une fiche, dans la langue demandée.
-- Retombe sur le français quand l'anglais n'a pas encore été généré : mieux
-- vaut une fiche lisible dans l'autre langue qu'un écran vide.
create or replace function public.brand_content(p_brand text, p_lang text default 'fr')
returns setof public.brand_descriptions
language sql
stable
as $$
  select * from public.brand_descriptions
   where brand = p_brand and lang = p_lang and status = 'ready'
  union all
  select * from public.brand_descriptions
   where brand = p_brand and lang = 'fr' and status = 'ready'
     and not exists (
       select 1 from public.brand_descriptions
        where brand = p_brand and lang = p_lang and status = 'ready')
  limit 1
$$;

grant execute on function public.brand_content(text, text) to authenticated, anon;

notify pgrst, 'reload schema';

-- ── Correctif : `description` ne peut plus être obligatoire ──
-- La ligne de VERROU naît avant toute génération : elle n'a, par définition,
-- pas encore de contenu. Tant que `description` était NOT NULL, poser le
-- verrou échouait en 23502 — le mécanisme anti-double-génération ne pouvait
-- tout simplement pas démarrer.
--
-- La colonne reste pour les 19 fiches déjà payées, qui continuent de
-- s'afficher ; les nouvelles alimentent `summary` et `history`.
alter table public.brand_descriptions alter column description drop not null;

notify pgrst, 'reload schema';
