-- Accepted-offer payment reminders.
--
-- QC 2026-08-14: 12 offers had been accepted and NONE was ever paid. An
-- accepted offer is terminal-looking but still needs the buyer to check out,
-- and nothing ever followed up — the hourly expire-offers cron only touches
-- `pending` rows, so an accepted offer sits forever (several were 4 weeks
-- stale). These columns let a daily cron send a short reminder sequence,
-- CAS-claimed per offer so a crash mid-run can never double-send.
--
-- Additive + defaulted: existing rows read as "never nudged" and the offers
-- feature behaves identically until the cron ships.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS payment_nudge_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_nudge_count  INTEGER NOT NULL DEFAULT 0;

-- The cron scans accepted-and-unpaid rows ordered by how long they have sat.
-- Partial index keeps that scan off the 40+ terminal rows.
CREATE INDEX IF NOT EXISTS idx_offers_accepted_unpaid
  ON public.offers (updated_at)
  WHERE status = 'accepted' AND accepted_order_id IS NULL;
