-- One-shot kickoff: activate this week's challenges and prime the
-- stats materialized view so the new RPCs return data immediately.
-- Safe to re-run.
select * from public.activate_weekly_challenges();
select public.refresh_global_stats();
