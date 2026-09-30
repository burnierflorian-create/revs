-- Le quota d'ANALYSE IA du palier gratuit repasse de 10 à 5 par jour.
--
-- Il avait été porté à 10 le 30/09 au matin (migration 0086) ; le brief P0-3
-- du même jour redemande explicitement 5, et tous les textes d'interface qu'il
-- spécifie citent 5. On suit la dernière instruction.
--
-- Ce plafond ne concerne QUE `identify-car`. La détection de plaque en est
-- sortie le même jour : elle relève de la confidentialité, pas du forfait.
create or replace function public.ai_daily_limit(p_tier text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_tier, 'free'))
    when 'vip'     then 300
    when 'premium' then 30
    else 5
  end;
$$;

notify pgrst, 'reload schema';
