-- OBO Best-Offer notification preferences. Additive + NOT NULL DEFAULT true, so
-- accounts whose notification_preferences row predates this migration (or have
-- no row) still opt in by default via the `defaults` object in
-- lib/courier.ts:getUserNotifContext. Base table +
-- "System can read ... USING(true)" RLS policy for backend/edge reads live in
-- supabase/migrations/20260222_notification_preferences.sql.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS offer_email            BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_push             BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_accepted_email   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_accepted_push    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_rejected_email   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_rejected_push    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_countered_email  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_countered_push   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_expired_email    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_expired_push     BOOLEAN NOT NULL DEFAULT true;
