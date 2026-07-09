-- Widen the news.category check to the new spotting taxonomy so the
-- keyword categoriser can store Électrique / JDM / Classique / SUV
-- alongside the existing F1 / Supercar / Hypercar (Events/Auto kept for
-- backward-compat with any legacy rows).
-- Apply: node scripts/apply-rls.mjs supabase/0050-news-categories.sql

alter table public.news drop constraint if exists news_category_check;
alter table public.news
  add constraint news_category_check
  check (category in (
    'F1', 'Supercar', 'Hypercar', 'Électrique', 'JDM', 'Classique', 'SUV',
    'Events', 'Auto'
  ));

notify pgrst, 'reload schema';
