-- OBO Best-Offer system: opt-in flag on a listing.
-- Additive + defaulted, so every existing listing is `false` (no "Make an
-- offer" button appears anywhere) until sellers opt in. Base table is
-- supabase/migrations/20260124_initial_schema.sql:39-53.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS accepts_offers BOOLEAN NOT NULL DEFAULT false;
