-- =============================================================================
-- Shippop infrastructure cleanup
-- =============================================================================
-- Run this manually in the Supabase SQL editor (Supabase → SQL Editor → New
-- query → paste → Run). It is NOT included in the migrations folder because
-- migrations should be append-only; this is a one-time hand-applied cleanup.
--
-- Before running: confirm in the Supabase Dashboard that you have undeployed
-- these Edge Functions (they were also removed from the repo):
--   - shippop-webhook
--   - create-shipping-label
--
-- What this drops:
--   1. The shippop_purchase_id column on shipping_labels (Flash uses
--      flash_order_id / tracking_number instead)
--   2. The shipping_addresses table — never referenced by any app code; all
--      address data is stored inline on profiles
--   3. Any leftover Shippop-specific shipping_labels.status values are
--      preserved as historical data; the CHECK constraint already permits
--      the values Flash uses
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

BEGIN;

-- 1. Remove the Shippop tracking column from shipping_labels
ALTER TABLE public.shipping_labels
    DROP COLUMN IF EXISTS shippop_purchase_id;

-- 2. Drop the shipping_addresses table and its supporting objects
--    (function + trigger are cascaded by DROP TABLE)
DROP TRIGGER IF EXISTS ensure_single_default_address_trigger ON public.shipping_addresses;
DROP FUNCTION IF EXISTS public.ensure_single_default_address();
DROP TABLE IF EXISTS public.shipping_addresses CASCADE;

-- 3. Drop the orphaned FK column on orders that referenced shipping_addresses
ALTER TABLE public.orders
    DROP COLUMN IF EXISTS shipping_address_id;

COMMIT;

-- =============================================================================
-- Sanity checks (run separately, expect each to return 0 rows)
-- =============================================================================
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'shipping_labels'
--   AND column_name = 'shippop_purchase_id';
--
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'shipping_addresses';
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'orders'
--   AND column_name = 'shipping_address_id';
