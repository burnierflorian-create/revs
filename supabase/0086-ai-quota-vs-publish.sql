-- ═══════ SÉPARER LE QUOTA D'ANALYSE IA DU PLAFOND DE PUBLICATION ═══════
--
-- CE QUI ÉTAIT MÉLANGÉ
-- Un seul nombre — 5 pour le palier gratuit — servait à deux choses sans
-- rapport : le nombre d'analyses IA payantes, et le nombre de spots publiables.
-- Le portail IA allait jusqu'à refuser un SCAN parce que le quota de
-- PUBLICATION était atteint. Un spotteur pouvait donc se retrouver dans cette
-- situation absurde : « j'ai utilisé mes analyses, je ne peux plus rien
-- publier », alors que publier ne coûte rien à personne.
--
-- CE QUI CHANGE
--   · Le quota IA garde son rôle : il protège la facture Anthropic. Il passe
--     de 5 à 10 par jour pour le palier gratuit en bêta.
--   · La publication n'a plus de quota commercial. Il reste un plafond
--     ANTI-ABUS, très haut, dont aucun usage humain ne s'approche : il n'est
--     pas là pour rationner un utilisateur mais pour arrêter un script.
--
-- Le trigger de la migration 0068 est CONSERVÉ, pas supprimé : il force aussi
-- `created_at := now()`, sans quoi n'importe quel client pourrait antidater ses
-- insertions. Seul son plafond change.

-- ─────────────── 1. Le quota d'ANALYSE IA, lisible en SQL ───────────────
-- Réplique volontaire de DAILY_LIMITS dans server/ai-gate.js, qui reste la
-- référence exécutoire (c'est lui qui refuse l'appel à Claude). Cette fonction
-- n'existe que pour que l'application puisse AFFICHER le même chiffre que celui
-- qui sera appliqué. Si l'un change, changer l'autre.
--   free / starter  10  ·  premium  30  ·  vip  300
create or replace function public.ai_daily_limit(p_tier text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_tier, 'free'))
    when 'vip'     then 300
    when 'premium' then 30
    else 10             -- free, starter, et tout tier inconnu
  end;
$$;

-- ─────────────── 2. Le plafond de PUBLICATION devient anti-abus ───────────────
-- 200/jour : hors d'atteinte d'un spotteur (le compte le plus actif de REVS
-- totalise une trentaine de spots DEPUIS SA CRÉATION), mais suffisant pour
-- qu'une boucle défectueuse ou un script s'arrête avant d'inonder la carte.
-- Ce n'est PAS un argument commercial : aucun palier n'achète ce chiffre, et
-- il ne doit être cité dans aucune offre.
create or replace function public.spot_daily_limit(p_tier text)
returns integer
language sql
immutable
as $$
  select 200;
$$;

-- ─────────────── 3. Le quota IA du jour, pour l'affichage ───────────────
-- `ai_usage` a RLS active et AUCUNE policy : le client ne peut donc pas lire
-- son propre compteur. Plutôt que d'ouvrir la table — qui porte l'historique
-- de tous les utilisateurs — on expose exactement ce qui doit être affiché,
-- pour le seul appelant, via auth.uid().
--
-- Le compteur retenu est celui de `identify-car` : c'est l'appel qui porte
-- l'analyse. `detect-plate` part sur la même photo et suit le même rythme ;
-- afficher les deux n'aurait aucun sens pour l'utilisateur, qui ne compte
-- qu'en photos analysées.
--
-- ⚠️ INDICATIF SEULEMENT. L'autorité reste server/ai-gate.js : ce que renvoie
-- cette fonction sert à informer, jamais à autoriser.
create or replace function public.my_ai_quota()
returns table (used integer, "limit" integer, remaining integer, tier text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_tier  text;
  v_used  integer := 0;
  v_limit integer;
begin
  if v_user is null then
    return;                       -- non connecté : aucune ligne, pas d'erreur
  end if;

  begin
    v_tier := public.user_tier(v_user);
  exception when others then
    v_tier := null;
  end;
  v_limit := public.ai_daily_limit(v_tier);

  select coalesce(u.count, 0) into v_used
    from public.ai_usage u
   where u.user_id = v_user
     and u.endpoint = 'identify-car'
     and u.day = (now() at time zone 'Europe/Paris')::date;

  v_used := coalesce(v_used, 0);

  return query
    select v_used,
           v_limit,
           greatest(0, v_limit - v_used),
           coalesce(v_tier, 'free');
end;
$$;

grant execute on function public.ai_daily_limit(text) to anon, authenticated;
grant execute on function public.my_ai_quota()        to authenticated;
revoke all on function public.my_ai_quota() from anon;

notify pgrst, 'reload schema';
