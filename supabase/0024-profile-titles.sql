-- ─────────────────────── User titles ───────────────────────
-- XP-derived titles live in JS (src/lib/titles.ts). The `title` column
-- on profiles is reserved for MANUAL special titles that should override
-- the XP-based one: 'Fondateur', 'Organisateur Vérifié', 'VIP Member'.
-- A null value means "use the XP-derived title".

alter table public.profiles
  add column if not exists title text;

create index if not exists profiles_title_idx
  on public.profiles (title)
  where title is not null;

-- ─────────────────────── Founder grants ───────────────────────
-- Florian & Niko get the gold 🏅 'Fondateur' title on every device.
-- Lookup goes through auth.users by email — if the email isn't on the
-- project yet, the update is a no-op (no error).

update public.profiles
set title = 'Fondateur'
where user_id in (
  select id from auth.users
  where email in (
    'burnierflorian@apexline92.com',
    'nikolajagodic30@gmail.com'
  )
);

-- Quick visibility check for debugging (returns founders if applied).
notify pgrst, 'reload schema';
