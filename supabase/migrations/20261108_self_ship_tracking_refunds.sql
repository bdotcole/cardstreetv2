-- Seller-ships-we-track model (2026-11-08):
--   * sellers ship a paid order themselves and type in the carrier's number
--     (lib/parcels shipSelf; the label row carries tracking_number 'SELF'
--     plus the 20261016 handoff columns);
--   * 17TRACK follows that number (lib/track17, lib/externalTracking,
--     /api/webhooks/track17), with bookkeeping on the label row;
--   * unshipped orders are refunded in code (lib/orderRefunds) by the buyer,
--     the cancel-unshipped-orders cron, or an admin, recorded on order_refunds;
--   * a seller who caused such a refund gets a strike on their profile.
-- Every column is nullable or defaulted and every reader fails soft without
-- it, so this can run before or after the code deploys.

ALTER TABLE public.shipping_labels
  ADD COLUMN IF NOT EXISTS track17_registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS track17_carrier       INTEGER,
  ADD COLUMN IF NOT EXISTS track17_status        TEXT,
  ADD COLUMN IF NOT EXISTS track17_checked_at    TIMESTAMPTZ;

COMMENT ON COLUMN public.shipping_labels.track17_status IS
  '17TRACK latest_status.status (NotFound, InfoReceived, InTransit, OutForDelivery, Delivered, Exception...) or Stopped; null = never asked';

-- Faster lookups by the seller's number (webhook + poll).
CREATE INDEX IF NOT EXISTS idx_shipping_labels_handoff_tracking_number
  ON public.shipping_labels(handoff_tracking_number)
  WHERE handoff_tracking_number IS NOT NULL;

-- order_refunds grew from "a note that a dashboard refund happened" into the
-- record of a refund we made. The primary key on order_id stays the
-- idempotency claim.
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS amount_satang    INTEGER,
  ADD COLUMN IF NOT EXISTS status           TEXT,
  ADD COLUMN IF NOT EXISTS source           TEXT,
  ADD COLUMN IF NOT EXISTS transfer_group   TEXT;

COMMENT ON COLUMN public.order_refunds.status IS
  'Stripe refund status (pending/succeeded/failed), manual = refunded in the dashboard, none = nothing to refund';
COMMENT ON COLUMN public.order_refunds.source IS
  'buyer_cancel | auto_unshipped | admin (lib/orderRefunds RefundSource)';

-- Why an order is cancelled, for the order page and support.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

COMMENT ON COLUMN public.orders.cancel_reason IS
  'buyer_cancelled_unshipped | seller_unshipped_auto | admin_refund; null for pre-payment cancels';

-- Seller strikes: refunds caused by not shipping.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unshipped_cancel_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unshipped_cancelled_at TIMESTAMPTZ;
