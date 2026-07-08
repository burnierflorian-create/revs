-- One-off: seed last_fetched_at with the true last article-insert time so the
-- "Mis à jour" label is coherent immediately (the 06:00 Paris cron takes over).
update public.news_meta
set last_fetched_at = coalesce(
  (select max(created_at) from public.news),
  last_fetched_at
)
where id = 'singleton';
