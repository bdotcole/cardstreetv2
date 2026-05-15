-- Tighten orders RLS so sellers can no longer flip status / escrow_status /
-- total_amount on their own orders via direct DB access. Those transitions
-- must go through service-role code paths (fulfillOrder, release-funds,
-- /api/orders/complete) which apply the right CAS guards and side effects.
--
-- Same treatment for shipping_labels: sellers should not be able to mutate
-- tracking numbers or status from the client; those fields are owned by the
-- Flash Express webhook + fulfillment pipeline.

-- ─── orders ───
DROP POLICY IF EXISTS "Sellers can update their own orders" ON public.orders;

-- (No replacement policy. All order updates now go through service-role.)

-- ─── shipping_labels ───
DROP POLICY IF EXISTS "Sellers can insert shipping labels for their orders" ON public.shipping_labels;
DROP POLICY IF EXISTS "Sellers can update shipping labels for their orders" ON public.shipping_labels;

-- (No replacement policies. Inserts/updates happen via service-role only.)
