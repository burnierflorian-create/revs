-- Public counter of active Premium / VIP subscribers — used as social
-- proof on the /premium page. RLS hides individual subscriptions from
-- non-owners, so we expose only the COUNT via a security-definer RPC.
-- Apply: node scripts/apply-rls.mjs supabase/0014-premium-count.sql

create or replace function public.premium_member_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.subscriptions
  where status in ('active', 'trialing')
    and plan is not null;
$$;

grant execute on function public.premium_member_count() to anon, authenticated;

notify pgrst, 'reload schema';
