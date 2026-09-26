-- ─────────────────────── Vanity referral code REVS74 ───────────────────────
-- Referral codes in this schema are per-profile (profiles.invite_code),
-- redeemed through claim_referral(). There is no separate referral_codes
-- table. To ship a shareable "REVS74" code we assign it as the invite
-- code of the founder account (Florian). It then works with zero usage
-- limit: any number of distinct new users can claim it, each linking to
-- Florian and awarding +50 XP to both.
--
-- REVS74 is a valid 6-char uppercase-alphanumeric code, so the client
-- format gate (/^[A-Z0-9]{6}$/) and claim_referral both accept it.
-- Idempotent: safe to re-run.
do $$
declare
  v_flo    uuid;
  v_holder uuid;
begin
  select p.user_id into v_flo
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where lower(u.email) = 'burnier.florian13@gmail.com'
  limit 1;

  if v_flo is null then
    raise notice 'REVS74: founder profile not found — no assignment made';
    return;
  end if;

  -- If REVS74 is already held (e.g. randomly generated for another user),
  -- rotate that holder to a fresh code so the unique index does not block us.
  select user_id into v_holder from public.profiles where invite_code = 'REVS74';
  if v_holder is not null and v_holder <> v_flo then
    update public.profiles
      set invite_code = public.gen_invite_code()
      where user_id = v_holder;
  end if;

  update public.profiles set invite_code = 'REVS74' where user_id = v_flo;
  raise notice 'REVS74: assigned to founder %', v_flo;
end $$;

-- Verification row (visible in the query response).
select u.email, p.invite_code
from public.profiles p
join auth.users u on u.id = p.user_id
where p.invite_code = 'REVS74';
