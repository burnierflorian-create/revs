-- REVS — bump news TTL from 24h to 48h so the feed never goes empty
-- between cron runs (and 4x/day fetches don't shrink the visible
-- window). Idempotent; apply via:
--   node scripts/apply-rls.mjs supabase/0011-news-ttl-48h.sql

alter table public.news
  alter column expires_at set default (now() + interval '48 hours');

-- Update the safety trigger so service-role inserts that omit
-- expires_at still get the new 48h window.
create or replace function public.news_set_expiry()
  returns trigger language plpgsql as $$
begin
  if new.expires_at is null then
    new.expires_at :=
      coalesce(new.published_at, now()) + interval '48 hours';
  end if;
  return new;
end; $$;

-- Extend currently-live articles by the extra 24h so the feed doesn't
-- visibly shrink right after we ship.
update public.news
set expires_at = expires_at + interval '24 hours'
where expires_at > now();

notify pgrst, 'reload schema';
