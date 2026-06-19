-- Real-time pseudo uniqueness check for the signup form. SECURITY DEFINER
-- so it can see ALL profiles (RLS would otherwise hide private ones) and
-- callable by anon (the check runs before the account exists).
-- Apply: node scripts/apply-rls.mjs supabase/0052-pseudo-available.sql

create or replace function public.pseudo_available(p_pseudo text)
returns boolean
language sql security definer set search_path = public stable as $$
  select not exists (
    select 1 from public.profiles
    where lower(trim(pseudo)) = lower(trim(p_pseudo))
  );
$$;
grant execute on function public.pseudo_available(text) to anon, authenticated;

notify pgrst, 'reload schema';
