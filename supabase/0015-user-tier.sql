-- Public tier lookup — returns 'premium' / 'vip' / null for a given
-- user. RLS on `subscriptions` hides individual rows from non-owners,
-- so we expose ONLY the derived tier (no amount, no plan, no dates).
-- Apply: node scripts/apply-rls.mjs supabase/0015-user-tier.sql

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
  limit 1;
$$;

grant execute on function public.user_tier(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
