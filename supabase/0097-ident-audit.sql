-- ═══════ 0097 — JOURNAL DES CORRECTIONS D'IDENTIFICATION ═══════
--
-- ── POURQUOI UNE TABLE PLUTÔT QU'UN UPDATE SILENCIEUX ──
-- Corriger `spots.brand/model` écrase une donnée sans laisser de trace : si
-- une correction se révèle fausse, plus rien ne permet de revenir en arrière
-- ni même de savoir qu'une valeur a changé. L'audit du 01/10 a établi que la
-- fiche se trompait sur 3 spots sur 33 — et qu'elle était JUSTE sur 22. Une
-- correction est donc une opération à risque, pas une routine.
--
-- Chaque ligne conserve l'ancienne valeur, la nouvelle, la raison et le
-- niveau de certitude. C'est ce qui rend la correction réversible.
--
-- ── CE QUI N'EST PAS ICI ──
-- Aucune contrainte de clé étrangère vers `spots` : si un spot est supprimé,
-- la trace de ce qui lui a été fait doit survivre.

create table if not exists public.ident_corrections (
  id            uuid primary key default gen_random_uuid(),
  spot_id       uuid not null,
  old_brand     text,
  old_model     text,
  old_year      int,
  new_brand     text,
  new_model     text,
  new_year      int,
  -- 'confirmed' : deux analyses indépendantes concordent ET contredisent la
  -- fiche, et un humain a vérifié la photo. 'manual' : correction saisie par
  -- l'utilisateur, qui fait alors autorité.
  certainty     text not null check (certainty in ('confirmed', 'manual')),
  reason        text not null,
  evidence      text,
  corrected_at  timestamptz not null default now()
);

create index if not exists ident_corrections_spot_idx
  on public.ident_corrections (spot_id, corrected_at desc);

alter table public.ident_corrections enable row level security;

-- Journal d'administration : aucune policy de lecture pour les clients.
-- Seul le service_role y accède, et il contourne RLS. Rien à exposer dans
-- l'application — c'est une trace d'exploitation, pas une donnée produit.

-- ── IDENTIFICATION FAISANT AUTORITÉ ──
-- Quand l'utilisateur corrige lui-même marque/modèle, sa saisie devient la
-- vérité du spot et aucune analyse IA ultérieure ne doit la remplacer. Sans
-- ce drapeau, un futur passage d'audit « corrigerait » une donnée humaine
-- exacte en se fiant à sa propre lecture.
alter table public.spots
  add column if not exists ident_locked boolean not null default false;

comment on column public.spots.ident_locked is
  'true = marque/modèle validés par un humain. Aucune ré-identification automatique ne doit les écraser.';
