-- ─────────────────────── Stylized garage image ───────────────────────
-- Filled asynchronously by the car-info?action=garage-image endpoint
-- shortly after a spot is inserted. Sentinel values:
--   NULL  → never attempted yet (newborn spot)
--   ''    → attempted, no usable image found → fallback in UI
--   http* → press / brand photo URL ready to render
-- This avoids a status column while still letting the worker refuse
-- to retry indefinitely.

alter table public.spots
  add column if not exists garage_image_url text;
