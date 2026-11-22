-- Stored copies of place photos (P-013 allows storing website photos).
-- Spec: docs/superpowers/specs/2026-11-21-place-photo-copies-design.md
-- The copy's object path goes in the existing storage_path column (bucket place-photos, pipeline/<restaurant_id>/…).
alter table public.place_photos
  add column stored_at    timestamptz,
  add column stored_bytes integer check (stored_bytes > 0),
  add column store_error  text;
