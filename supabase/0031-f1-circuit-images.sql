-- Per-round cached image URL for F1 circuits. Populated by the
-- one-shot backfill script (scripts/backfill-circuit-images.mjs) via
-- the Wikipedia MediaWiki API — pure thumbnail resolution, no Claude
-- tokens spent. Public read so the Calendar component can fetch all
-- 24 URLs in a single anon query.
-- Apply: node scripts/apply-rls.mjs supabase/0031-f1-circuit-images.sql

create table if not exists public.f1_circuit_images (
  round        int primary key,
  url          text not null,
  generated_at timestamptz not null default now()
);

alter table public.f1_circuit_images enable row level security;

drop policy if exists "f1 circuit images public read" on public.f1_circuit_images;

create policy "f1 circuit images public read"
  on public.f1_circuit_images for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
