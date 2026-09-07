-- Buyer problem reports (the path behind the CardStreet Guarantee).
--
-- The guarantee itself is a policy: every seller is identity-verified through
-- Stripe, a bad actor is banned, and the buyer is made whole from CardStreet's own
-- funds. What was missing was a way for the buyer to raise it and for completion
-- to stop while it is looked at. 'disputed' has been a legal orders.status since
-- 20260204_shipping_automation.sql; release-funds only touches delivered/completed
-- and /api/orders/complete only accepts shipped..delivered, so the status alone
-- halts the money side. These columns record why, when, and how it ended.
--
-- The app fails soft before this runs: /api/orders/[id]/report falls back to a
-- status-only update, and the ticket is filed under 'General' if 'Order' is not
-- yet an allowed category.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispute_reason        TEXT,
  ADD COLUMN IF NOT EXISTS dispute_details       TEXT,
  ADD COLUMN IF NOT EXISTS dispute_opened_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_ticket_id     UUID REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_outcome       TEXT,
  ADD COLUMN IF NOT EXISTS status_before_dispute TEXT;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_dispute_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_dispute_reason_check
  CHECK (dispute_reason IS NULL OR dispute_reason IN ('not_received', 'not_as_described', 'damaged', 'other'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_dispute_outcome_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_dispute_outcome_check
  CHECK (dispute_outcome IS NULL OR dispute_outcome IN ('refunded', 'rejected', 'resolved'));

CREATE INDEX IF NOT EXISTS idx_orders_open_disputes
  ON public.orders (dispute_opened_at DESC)
  WHERE status = 'disputed';

-- Problem reports file as support tickets so the existing admin console and reply
-- thread carry the conversation. 'Order' is the category the report route uses.
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_category_check
  CHECK (category IN ('Technical', 'Billing', 'Card Valuation', 'General', 'Order'));
