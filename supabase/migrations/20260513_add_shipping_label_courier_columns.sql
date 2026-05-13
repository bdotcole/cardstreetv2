-- =============================================================================
-- Restore missing courier columns on shipping_labels
-- =============================================================================
-- These columns were present in the original 20260204_shipping_automation.sql
-- but the simpler 20260221_orders_schema.sql replaced that table definition
-- (both used IF NOT EXISTS, so whichever ran first determined the final shape;
-- in this project the simpler schema won).
--
-- Code path that referenced them:
--   - lib/fulfillOrder.ts INSERTs courier_tracking_url after every successful
--     Flash shipment. Postgres rejected the row with "column does not exist",
--     so shipping_labels stayed empty even though the order advanced to
--     status='label_generated'. Seller saw the order but no Print Label
--     button.
--   - app/api/profile/orders/route.ts SELECTs courier_tracking_url for the
--     buyer's Track Orders panel. Same error — manifested as the buyer's
--     Track Orders being completely empty.
--
-- estimated_delivery_date is included for the same reason: code reads it,
-- column never existed.
-- =============================================================================

ALTER TABLE public.shipping_labels
    ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT,
    ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE;
