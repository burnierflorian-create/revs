-- ═══════ 0098 — RÉPARER L'ENREGISTREMENT DES ABONNEMENTS STRIPE ═══════
--
-- ── CE QUI ÉTAIT CASSÉ ──
-- `api/webhook.ts` enregistre un abonnement ainsi :
--
--     admin.from('subscriptions').upsert(
--       { ...row, updated_at: new Date().toISOString() },
--       { onConflict: 'user_id' },
--     )
--
-- Deux choses manquaient dans la table, et chacune suffisait à faire échouer
-- l'écriture ENTIÈRE :
--   1. la colonne `updated_at` n'existait pas — PostgREST rejette la requête
--      avec « Could not find the 'updated_at' column » ;
--   2. aucun index UNIQUE sur `user_id` — `onConflict: 'user_id'` n'a alors
--      aucune contrainte sur laquelle s'appuyer.
--
-- Conséquence vérifiée le 02/10/2026 en reproduisant exactement la charge du
-- webhook : l'upsert échoue, `subscriptions` reste vide, `user_tier()` renvoie
-- null, et l'utilisateur garde le quota gratuit de 5 analyses. Comme Stripe est
-- en mode LIVE, REVS encaisse réellement et ne délivre rien.
--
-- Le webhook journalise bien l'échec (console.error) mais répond 200 à Stripe :
-- côté Stripe l'événement est « traité », il n'est jamais rejoué, et rien
-- n'alerte. Un échec silencieux de bout en bout.
--
-- ── POURQUOI UN INDEX UNIQUE SUR user_id ──
-- Un utilisateur n'a qu'un abonnement REVS à la fois. Sans cette contrainte,
-- un changement de formule créerait une seconde ligne, et `user_tier()` — qui
-- fait `limit 1` sans ordre — renverrait l'une ou l'autre au hasard : un
-- utilisateur passé de premium à annulé pourrait rester premium.
--
-- Déduplication préalable obligatoire : on garde la ligne la plus récente de
-- chaque utilisateur avant de poser l'index, sinon sa création échoue.

alter table public.subscriptions
  add column if not exists updated_at timestamptz not null default now();

-- Dédoublonnage défensif. `created_at` peut être null sur d'anciennes lignes,
-- d'où le coalesce : sans lui, ces lignes seraient triées en premier et on
-- garderait la plus ancienne.
delete from public.subscriptions a
 using public.subscriptions b
 where a.user_id is not null
   and a.user_id = b.user_id
   and coalesce(a.created_at, 'epoch'::timestamptz) < coalesce(b.created_at, 'epoch'::timestamptz);

create unique index if not exists subscriptions_user_id_key
  on public.subscriptions (user_id);

comment on column public.subscriptions.updated_at is
  'Écrit par api/webhook.ts à chaque événement Stripe. Son absence faisait échouer tout l''upsert.';

-- ── ORDRE DÉTERMINISTE POUR user_tier() ──
-- La fonction fait `limit 1` sans `order by`. Avec l''index unique ci-dessus il
-- ne peut plus exister qu''une ligne par utilisateur, donc le résultat devient
-- déterministe. On la réécrit tout de même avec un ordre explicite : dépendre
-- d''une contrainte posée ailleurs pour la correction d''une fonction est le
-- genre de couplage qui se casse au prochain changement de schéma.
create or replace function public.user_tier(p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select
    case
      when status not in ('active', 'trialing') then null
      when plan is null then null
      when plan like 'vip%' or plan = 'vip' then 'vip'
      when plan like 'premium%' or plan = 'premium' then 'premium'
      when plan = 'starter' then 'starter'
      else null
    end
  from public.subscriptions
  where user_id = p_user
  order by updated_at desc
  limit 1;
$$;

grant execute on function public.user_tier(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
