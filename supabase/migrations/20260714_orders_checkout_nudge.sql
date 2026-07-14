-- Abandoned-checkout recovery: one-shot nudge guard on orders.
--
-- When a buyer starts a checkout but never completes payment (e.g. a PromptPay
-- QR left unscanned), /api/orders/checkout reserves the listing and the order
-- is later cancelled by the reconcile cron / webhook. The buyer-payment-nudge
-- cron (app/api/cron/buyer-payment-nudge) sends ONE re-engagement email/push
-- pointing them back to the still-available card. This column is the CAS guard
-- that makes it exactly-once per order — same pattern as
-- profiles.stripe_setup_nudge_sent_at for the seller-side onboarding nudge.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS checkout_nudge_sent_at timestamptz;

-- The cron scans for cancelled, never-paid, not-yet-nudged orders. A partial
-- index keeps that scan cheap as the orders table grows — the vast majority of
-- rows are paid/fulfilled and never match, so they stay out of the index.
CREATE INDEX IF NOT EXISTS idx_orders_checkout_nudge_pending
    ON orders (created_at)
    WHERE status = 'cancelled'
      AND payment_id IS NULL
      AND checkout_nudge_sent_at IS NULL;
