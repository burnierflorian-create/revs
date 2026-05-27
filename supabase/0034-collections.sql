-- Collections — state-only table. Eligibility rules + XP rewards live
-- in src/lib/collections.ts so the catalogue can evolve without a
-- migration. The RPC `claim_collection` locks the XP per collection
-- ID server-side so a hostile client can't inflate the reward.
-- Apply: node scripts/apply-rls.mjs supabase/0034-collections.sql

create table if not exists public.collection_progress (
  user_id        uuid not null references auth.users (id) on delete cascade,
  collection_id  text not null,
  completed_at   timestamptz not null default now(),
  xp_awarded     int  not null check (xp_awarded > 0),
  primary key (user_id, collection_id)
);

alter table public.collection_progress enable row level security;

drop policy if exists "collection_progress read own"
  on public.collection_progress;

create policy "collection_progress read own"
  on public.collection_progress for select to authenticated
  using (user_id = auth.uid());

-- claim_collection: single-shot per (user, collection_id). The XP
-- reward is decided here, not by the caller — prevents inflation.
-- Returns (ok, xp). Re-calling returns ok=false but still the canonical
-- xp so the UI can render the claimed state without an extra fetch.
create or replace function public.claim_collection(p_collection_id text)
returns table (ok boolean, xp int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_xp   int;
begin
  v_xp := case p_collection_id
    when 'amg-collection'   then 300
    when 'british-trio'     then 250
    when 'jdm-legend'       then 200
    when 'italian-big-3'    then 350
    when 'hypercar-club'    then 500
    else null
  end;
  if v_user is null or v_xp is null then
    return query select false, 0;
    return;
  end if;
  if exists(
    select 1 from public.collection_progress
    where user_id = v_user and collection_id = p_collection_id
  ) then
    return query select false, v_xp;
    return;
  end if;
  insert into public.collection_progress (user_id, collection_id, xp_awarded)
    values (v_user, p_collection_id, v_xp);
  insert into public.xp_transactions (user_id, amount, reason)
    values (v_user, v_xp, 'collection:' || p_collection_id);
  return query select true, v_xp;
end;
$$;

grant execute on function public.claim_collection(text) to authenticated;

notify pgrst, 'reload schema';
