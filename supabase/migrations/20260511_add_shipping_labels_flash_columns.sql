-- =============================================================================
-- Bug #A fix: add missing columns to shipping_labels required by lib/fulfillOrder.ts
-- =============================================================================
-- Without these columns the INSERT in fulfillOrder.ts fails with PGRST204
-- ("Could not find a relationship"), leaving orders stuck in 'paid' status
-- with no shipping_label record and no tracking number visible to buyer or seller.
--
-- The original schema (20260204_shipping_automation.sql) had `shippop_purchase_id`
-- as a legacy column from the Shippop integration. A migration comment referenced
-- renaming it to flash_order_id in 20260502_flash_express_migration.sql, but that
-- migration was never created. This migration handles both cases safely via a DO block.
-- =============================================================================

BEGIN;

-- ─── 1. Rename shippop_purchase_id → flash_order_id (if old column still exists) ───
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'shipping_labels'
          AND column_name  = 'shippop_purchase_id'
    ) THEN
        ALTER TABLE shipping_labels RENAME COLUMN shippop_purchase_id TO flash_order_id;
        RAISE NOTICE 'Renamed shippop_purchase_id → flash_order_id';
    ELSE
        RAISE NOTICE 'shippop_purchase_id not found — skipping rename (already renamed or never existed)';
    END IF;
END $$;

-- ─── 2. Add flash_order_id if neither name exists ───
-- Handles the case where the column was never created at all.
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS flash_order_id TEXT;

-- ─── 3. Add Flash Express sort code ───
-- Printed on the label barcode strip; needed for Flash internal routing.
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS flash_sort_code TEXT;

-- ─── 4. Add pickup scheduling columns ───
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS pickup_id TEXT;
ALTER TABLE shipping_labels
    ADD COLUMN IF NOT EXISTS pickup_status TEXT DEFAULT 'pending'
    CHECK (pickup_status IN ('pending', 'scheduled', 'manual', 'cancelled'));

-- ─── Verification ───
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'shipping_labels'
ORDER BY ordinal_position;

COMMIT;
