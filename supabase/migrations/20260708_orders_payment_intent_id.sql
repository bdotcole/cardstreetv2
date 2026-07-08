-- Reconciliation support for stalled checkouts.
--
-- /api/orders/checkout creates orders at `pending_payment` and reserves their
-- listings (`active -> sold`) BEFORE the Stripe charge. If the buyer abandons,
-- the order is orphaned and the listing stays `sold` forever. The client cleans
-- up on modal close (/api/orders/cancel); this column lets a backstop cron
-- (app/api/cron/reconcile-pending-orders) verify a stalled order's real state
-- against Stripe before acting — so it never cancels an in-flight PromptPay or a
-- paid-but-webhook-lost order, and can RECOVER the latter by fulfilling it.
--
-- Distinct from `payment_id`, which is only stamped at fulfillment (pending ->
-- paid) and is the CAS/idempotency marker. This column is written at
-- PaymentIntent creation time, so it exists even for orders that never fulfilled.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

-- The cron scans stale pending_payment orders by age; a partial index keeps that
-- sweep cheap as the orders table grows.
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment_created
  ON public.orders (created_at)
  WHERE status = 'pending_payment';
