-- Add the delivery/escrow timestamp columns that the code has always assumed
-- exist but never did in production.
--
-- Root cause: 20260204_shipping_automation.sql declared `orders` with
-- `delivered_at` and `funds_release_at` inside a `CREATE TABLE IF NOT EXISTS`.
-- The orders table already existed (from the initial schema), so that whole
-- block — including these two columns and the escrow-release index — was a
-- no-op. As a result:
--   * the Flash webhook's delivered-branch update (status + delivered_at +
--     funds_release_at) errored on the missing columns and silently failed, so
--     no order could ever reach status='delivered'; and
--   * the release-funds cron filtered `.lte('funds_release_at', now)`, which
--     errored on every run, so escrow was never released / completed and the
--     seller payout notification never fired.
--
-- Idempotent: safe to run even where the columns somehow already exist.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;      -- set when Flash reports delivered
ALTER TABLE orders ADD COLUMN IF NOT EXISTS funds_release_at TIMESTAMPTZ;  -- delivered_at + 48h; escrow release gate

-- Matches the index the original (no-op'd) migration intended, so release-funds
-- scans only held orders whose release window has opened.
CREATE INDEX IF NOT EXISTS idx_orders_funds_release_at
    ON orders(funds_release_at) WHERE escrow_status = 'held';
