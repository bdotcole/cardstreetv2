-- Pending Shipments now keeps delivered/completed orders visible to the
-- seller (a delivery notice for sellers not opted into push/email) until the
-- seller dismisses the card. seller_cleared_at records that dismissal; the
-- shipments list filters on it. The order itself is untouched — it stays in
-- Sales History regardless.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS seller_cleared_at TIMESTAMPTZ;

-- Orders that completed before this feature already left the panel — mark
-- them cleared so history doesn't flood back into Pending Shipments when the
-- list starts including 'completed'.
UPDATE public.orders
SET seller_cleared_at = COALESCE(completed_at, updated_at, NOW())
WHERE status = 'completed'
  AND seller_cleared_at IS NULL;
