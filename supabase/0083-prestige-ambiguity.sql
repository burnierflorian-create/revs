-- ════════════════════════════════════════════════════════════════════════
--  0083 — claim_prestige() : lever la collision de noms
-- ════════════════════════════════════════════════════════════════════════
--
-- ── LE BUG, TROUVÉ EN TESTANT LE PARCOURS COMPLET ──
-- `claim_prestige()` est déclarée `returns table (ok, prestige, level)`. En
-- plpgsql, ces trois noms deviennent des VARIABLES DE SORTIE visibles dans
-- tout le corps de la fonction. Or le corps faisait :
--
--     select xp_total, prestige_xp_base, prestige into ...
--       from public.profiles where user_id = v_user;
--
-- `prestige` désigne alors aussi bien la variable de sortie que la colonne de
-- `profiles`. Postgres refuse de choisir et lève « column reference prestige
-- is ambiguous » — à l'EXÉCUTION seulement, ce qui explique que la migration
-- et son essai à blanc soient passés sans rien signaler.
--
-- Effet observé côté joueur : le bouton « Passer Prestige I » répondait « le
-- serveur a refusé » alors que le compte était bien niveau 100, le client
-- interprétant l'erreur RPC comme un refus.
--
-- ── LE CORRECTIF ──
-- Toutes les colonnes sont qualifiées par l'alias de table. La signature ne
-- change pas, donc aucun appelant n'est à adapter.
--
-- La leçon vaut pour toute fonction `returns table` : ses noms de sortie sont
-- des variables, et une lecture de colonne homonyme doit être qualifiée.

create or replace function public.claim_prestige()
returns table (ok boolean, prestige integer, level integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_xp   int;
  v_base int;
  v_pres int;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select p.xp_total, p.prestige_xp_base, p.prestige
    into v_xp, v_base, v_pres
    from public.profiles p
   where p.user_id = v_user
     for update;

  if not found then
    return query select false, 0, 1;
    return;
  end if;

  if public.revs_level_for_xp(greatest(0, v_xp - v_base)) < 100 then
    return query select false, v_pres, public.revs_level_for_xp(greatest(0, v_xp - v_base));
    return;
  end if;

  -- La nouvelle base est le seuil du niveau 100, PAS l'XP totale : l'excédent
  -- déjà gagné au-delà du niveau 100 est reporté sur le cycle suivant plutôt
  -- que perdu.
  update public.profiles p
     set prestige = p.prestige + 1,
         prestige_xp_base = p.prestige_xp_base + public.revs_xp_for_level(100)
   where p.user_id = v_user;

  select p.prestige, p.prestige_xp_base
    into v_pres, v_base
    from public.profiles p
   where p.user_id = v_user;

  return query select true, v_pres, public.revs_level_for_xp(greatest(0, v_xp - v_base));
end;
$$;

comment on function public.claim_prestige() is
  'Passe un prestige si le niveau 100 est atteint. Colonnes qualifiées : les noms de sortie (prestige, level) masqueraient sinon les colonnes de profiles.';
