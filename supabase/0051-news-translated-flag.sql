-- Cost-control flag for the news pipeline: marks whether an article's
-- title/summary have already been translated to French by Claude. New
-- rows are inserted with translated = true (summarize() translates them
-- inline); the column lets any future re-translation pass cheaply target
-- only translated = false rows instead of re-spending Claude on every run.
-- Apply: node scripts/apply-rls.mjs supabase/0051-news-translated-flag.sql

alter table public.news
  add column if not exists translated boolean not null default true;

notify pgrst, 'reload schema';
