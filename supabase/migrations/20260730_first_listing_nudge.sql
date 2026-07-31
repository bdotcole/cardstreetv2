-- First-listing activation nudge: 21 of 34 fully-verified sellers have never
-- listed a card (2026-07-30). One email + push, ever, sent by the daily
-- first-listing-nudge cron once a seller has been charges_enabled for >24h
-- with zero listings rows.
--
-- The column is the CAS token: the sender claims with
-- `SET first_listing_nudge_sent_at = now WHERE ... IS NULL`, so concurrent
-- cron runs can never double-send. The cron and sender both fail soft until
-- this runs.
--
-- Idempotent: safe to run more than once from the SQL Editor.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS first_listing_nudge_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.first_listing_nudge_sent_at IS
    'When the one-time "list your first card" activation nudge was sent. NULL = never. CAS token for lib/courier.ts:sendFirstListingNudgeEmail.';
