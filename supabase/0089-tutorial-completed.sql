-- ═══════ ÉTAT DU TUTORIEL DE DÉCOUVERTE ═══════
--
-- CE QUI N'EXISTAIT PAS
-- REVS n'avait aucun tutoriel d'accueil. `src/pages/Tutorial.tsx` et
-- `src/lib/tutorial.ts` portent le REVS Master Tutorial — la documentation
-- interne réservée au compte créateur — qui n'a rien à voir avec un parcours
-- de découverte utilisateur. Le seul état existant, `onboarding_completed`,
-- marque la fin du QUESTIONNAIRE, pas d'un tutoriel.
--
-- Deux états distincts, donc deux colonnes : un utilisateur peut avoir
-- terminé le questionnaire sans avoir vu le tutoriel (c'est le cas de tous les
-- comptes existants), et le tutoriel doit alors se lancer.

alter table public.profiles
  add column if not exists tutorial_completed boolean not null default false;

comment on column public.profiles.tutorial_completed is
  'Tutoriel de découverte vu jusqu''au bout OU passé volontairement. '
  'Distinct de onboarding_completed, qui marque la fin du questionnaire. '
  'Une fois à true, le tutoriel ne se relance jamais automatiquement.';

notify pgrst, 'reload schema';
