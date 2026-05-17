-- REVS — news 24h TTL. Idempotent; apply via:
--   node scripts/apply-rls.mjs supabase/0003-news-ttl.sql

alter table public.news add column if not exists expires_at timestamptz;

alter table public.news
  alter column expires_at set default (now() + interval '24 hours');

-- Backfill: live for 24h from publish (or insertion if undated).
update public.news
set expires_at = coalesce(published_at, created_at) + interval '24 hours'
where expires_at is null;

create index if not exists news_expires_at_idx
  on public.news (expires_at desc);

-- Guarantee expires_at is always set, whatever the caller does.
create or replace function public.news_set_expiry()
  returns trigger language plpgsql as $$
begin
  if new.expires_at is null then
    new.expires_at :=
      coalesce(new.published_at, now()) + interval '24 hours';
  end if;
  return new;
end; $$;

drop trigger if exists trg_news_set_expiry on public.news;
create trigger trg_news_set_expiry before insert on public.news
  for each row execute function public.news_set_expiry();
