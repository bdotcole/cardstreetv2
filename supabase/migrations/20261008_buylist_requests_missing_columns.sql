-- buylist_requests existed before 20260203_buylist_requests.sql ran, so its
-- CREATE TABLE IF NOT EXISTS was a no-op and the card snapshot columns were never
-- added. Every POST /api/buylist has failed since with PGRST204 ("Could not find
-- the 'card_image_url' column", Sentry CARDSTREET-1E) and the table holds no rows.
-- updated_at is also missing, which the existing BEFORE UPDATE trigger writes.
-- Additive and safe to re-run.

ALTER TABLE public.buylist_requests
  ADD COLUMN IF NOT EXISTS card_name TEXT,
  ADD COLUMN IF NOT EXISTS card_set TEXT,
  ADD COLUMN IF NOT EXISTS card_number TEXT,
  ADD COLUMN IF NOT EXISTS card_rarity TEXT,
  ADD COLUMN IF NOT EXISTS card_image_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

NOTIFY pgrst, 'reload schema';
