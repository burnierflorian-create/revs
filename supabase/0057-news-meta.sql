-- news_meta: single-row source of truth for the last SUCCESSFUL news fetch
-- (the once-daily 06:00 Europe/Paris cron). The client reads last_fetched_at
-- to render the "Mis à jour il y a X" label — no more inferring it from the
-- newest article's created_at (which is wrong on days with no new articles).

create table if not exists public.news_meta (
  id text primary key,
  last_fetched_at timestamptz not null default now()
);

alter table public.news_meta enable row level security;

-- Public read (the client shows the timestamp). Writes are service-role only
-- (the cron uses the service key, which bypasses RLS — no write policy needed).
drop policy if exists news_meta_read on public.news_meta;
create policy news_meta_read on public.news_meta for select using (true);

insert into public.news_meta (id, last_fetched_at)
values ('singleton', now())
on conflict (id) do nothing;
