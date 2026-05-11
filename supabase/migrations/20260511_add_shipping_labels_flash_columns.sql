-- =============================================================================
-- Bug #A fix: add missing Flash Express columns to shipping_labels
-- =============================================================================
-- lib/fulfillOrder.ts inserts flash_order_id, flash_sort_code, pickup_id, and
-- pickup_status into shipping_labels after every successful Flash Express
-- shipment creation. Without these columns the INSERT fails with PGRST204,
-- leaving orders stuck in 'paid' status with no label record.
-- =============================================================================

ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS flash_order_id TEXT;
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS flash_sort_code TEXT;
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS pickup_id TEXT;
ALTER TABLE shipping_labels
    ADD COLUMN IF NOT EXISTS pickup_status TEXT DEFAULT 'pending'
    CHECK (pickup_status IN ('pending', 'scheduled', 'manual', 'cancelled'));
