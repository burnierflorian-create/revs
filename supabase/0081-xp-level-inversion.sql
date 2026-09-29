-- ════════════════════════════════════════════════════════════════════════
--  0081 — Correction : l'inversion de la courbe se décalait d'un niveau
-- ════════════════════════════════════════════════════════════════════════
--
-- ── LE BUG, TROUVÉ AU BANC D'ESSAI ──
-- `revs_level_for_xp` inversait la courbe analytiquement :
--     N = 1 + floor( (xp / 100) ^ (1/1.5) )
-- ce qui est l'inverse exact de la formule CONTINUE 100 × (N−1)^1.5.
--
-- Mais les seuils stockés sont ARRONDIS. Quand `round()` arrondit vers le bas,
-- le seuil réel tombe juste sous la valeur continue, et l'inverse renvoie le
-- niveau précédent. Exemple : le niveau 6 vaut round(100 × 5^1.5) = 1 118,
-- alors que (1118/100)^(2/3) = 4,99991 → le joueur restait au niveau 5 en
-- ayant exactement l'XP du niveau 6.
--
-- Vérifié sur les 100 niveaux : **49 étaient faux**, soit un sur deux.
--
-- ── LE CORRECTIF ──
-- L'inverse analytique reste le point de départ — il est rapide et n'est
-- jamais éloigné de plus d'un niveau — mais il est désormais CORRIGÉ contre
-- les seuils réellement stockés. L'écart ne peut pas dépasser 1 : l'arrondi
-- déplace un seuil de moins de 0,5 XP, alors que deux niveaux consécutifs sont
-- toujours séparés d'au moins 100 XP.
--
-- La leçon vaut d'être notée : la courbe de référence et la courbe des seuils
-- ne sont pas la même fonction. Toute future modification de l'exposant ou du
-- coefficient doit repasser par ce test de cohérence.

create or replace function public.revs_level_for_xp(p_xp integer)
returns integer
language sql
immutable
as $$
  with cand as (
    select greatest(1, least(100,
      1 + floor(power(greatest(p_xp, 0)::numeric / 100.0, 1.0 / 1.5))::int
    )) as n
  )
  select greatest(1, least(100,
    case
      when public.revs_xp_for_level(cand.n + 1) <= greatest(p_xp, 0) then cand.n + 1
      when public.revs_xp_for_level(cand.n)     >  greatest(p_xp, 0) then cand.n - 1
      else cand.n
    end
  ))
  from cand;
$$;

comment on function public.revs_level_for_xp(integer) is
  'Niveau (1-100) pour une XP de cycle donnée. Inverse analytique corrigé contre les seuils arrondis réellement stockés.';
