-- =============================================================================
-- First-time seller sale email: durable one-shot guard
-- =============================================================================
-- When a seller's FIRST order reaches a paid (ship-now) status we send the
-- Courier "First Time Sale" onboarding email exactly once, ever. This column
-- is the durable idempotency key: NULL means "not yet sent", a timestamp means
-- "sent at this time". The send path claims the column with an atomic
-- compare-and-swap (UPDATE ... WHERE first_sale_email_sent_at IS NULL) so
-- duplicate webhook deliveries / repeated status updates can't double-send.
-- See lib/courier.ts:sendFirstTimeSaleEmail and lib/fulfillOrder.ts.
-- =============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS first_sale_email_sent_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill: any seller who ALREADY has a valid (paid-or-beyond) sale passed
-- their "first sale" before this feature existed. Stamp them now so the
-- onboarding email can never fire retroactively on their *next* sale. Only
-- genuinely-new first sales after this migration can trigger it.
-- Status set mirrors VALID_FIRST_SALE_STATUSES in lib/courier.ts.
UPDATE public.profiles p
SET first_sale_email_sent_at = now()
WHERE p.first_sale_email_sent_at IS NULL
  AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.seller_id = p.id
        AND o.status IN (
            'paid',
            'label_generated',
            'shipped',
            'in_transit',
            'out_for_delivery',
            'delivered',
            'completed'
        )
  );
