-- One-shot kickoff: prime the stats materialized view so the new RPCs
-- return data immediately. Safe to re-run.
--
-- The legacy global weekly rotation (activate_weekly_challenges) was
-- retired 2026-06-05 — challenges are now assigned per-user, adaptively
-- (migrations 0042/0043), so there is nothing to seed for them here.
select public.refresh_global_stats();
