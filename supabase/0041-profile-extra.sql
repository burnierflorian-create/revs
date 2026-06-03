-- ─────────────────── Profile extras — 2026-06-03 ───────────────────
-- Adds three optional identity columns on public.profiles:
--   garage_brand text — the user's daily-driver brand (free-form
--                       string, e.g. "Mercedes-Benz" / "BMW" / "Audi"
--                       / "Porsche"). Surfaced on /u/:id and as a
--                       Settings row labelled "Mon véhicule principal".
--   instagram text   — Instagram handle without the leading @. Stored
--                       trimmed; UI prepends @ on display.
--   tiktok text      — TikTok handle, same shape as instagram.
--
-- All three are nullable so existing rows are unaffected and the
-- Settings UI can keep them blank by default.
--
-- RLS: the existing "users update own profile" policy from schema.sql
-- already restricts UPDATE to auth.uid() = user_id, which covers
-- these new columns. No new policy needed.

begin;

alter table public.profiles
  add column if not exists garage_brand text;
alter table public.profiles
  add column if not exists instagram text;
alter table public.profiles
  add column if not exists tiktok text;

commit;
