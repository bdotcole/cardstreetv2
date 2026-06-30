-- Freight reconciliation: learn the ACTUAL Flash Express shipping cost.
--
-- The buyer pays an UP-FRONT estimate at checkout (orders.shipping_fee). Flash
-- only finalizes the freight when it physically weighs/measures the parcel at
-- the depot, adding remote-area surcharges and weight drift the estimate can't
-- see. Flash reports the real figures via its weight (code 1) and price
-- (code 2) webhooks; app/api/webhooks/flash writes them here so the gap is
-- recorded and auditable instead of silently absorbed by the platform/seller.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS actual_shipping_fee NUMERIC,
    ADD COLUMN IF NOT EXISTS actual_weight_grams INTEGER,
    ADD COLUMN IF NOT EXISTS shipping_fee_delta NUMERIC,
    ADD COLUMN IF NOT EXISTS shipping_reconciliation_raw JSONB;

COMMENT ON COLUMN public.orders.actual_shipping_fee IS
    'Actual freight billed by Flash Express (THB), learned from the price webhook. NULL until reconciled.';
COMMENT ON COLUMN public.orders.actual_weight_grams IS
    'Actual parcel weight measured by Flash (grams), from the weight webhook. NULL until reconciled.';
COMMENT ON COLUMN public.orders.shipping_fee_delta IS
    'actual_shipping_fee minus shipping_fee (THB). Positive = buyer under-quoted; the platform absorbed the difference. Used to tune the shipping buffer.';
COMMENT ON COLUMN public.orders.shipping_reconciliation_raw IS
    'Raw Flash weight/price webhook payload, kept for audit and to verify the exact field names against real traffic.';
