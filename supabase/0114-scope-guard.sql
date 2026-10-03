-- ═══════ GARDE-FOU : LE PÉRIMÈTRE MEMBRE NE SE REDÉCLARE PAS ═══════
--
-- La migration 0113 a ramené huit définitions concurrentes à une seule, la
-- vue `member_directory`. Rien n'empêche pourtant d'en réécrire une neuvième
-- dans six mois, au détour d'une fonction qui « avait juste besoin de
-- compter les membres ».
--
-- Cette fonction liste les coupables : toute routine de `public` qui
-- mentionne `onboarding_completed` ou `is_public` sans passer par la vue.
-- `scripts/members-audit.mjs` la lit et sort en erreur si elle renvoie quoi
-- que ce soit. Les chiffres seuls ne suffiraient pas : tant qu'aucun membre
-- n'est privé, une fonction fautive donne quand même le bon total — et le
-- jour où elle se trompe, c'est en production.
create or replace function public.functions_declaring_member_scope()
returns table (proname text)
language sql
stable
security definer
set search_path = public
as $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname <> 'functions_declaring_member_scope'
    and pg_get_functiondef(p.oid) ~* '(onboarding_completed|is_public)'
    and pg_get_functiondef(p.oid) !~* 'member_directory'
  order by 1;
$$;

notify pgrst, 'reload schema';
