-- Flash Express Migration
-- Updates schema from legacy column names to Flash Express conventions

-- Rename legacy column to Flash Express convention
ALTER TABLE shipping_labels RENAME COLUMN shippop_purchase_id TO flash_order_id;

-- Add pickup tracking fields
ALTER TABLE shipping_labels 
  ADD COLUMN IF NOT EXISTS pickup_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pickup_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS flash_sort_code TEXT DEFAULT NULL;

-- Add sub_district to profiles for Flash Express address accuracy
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS sub_district TEXT DEFAULT NULL;

-- Update comment on shipping_labels table
COMMENT ON TABLE shipping_labels IS 'Flash Express shipping integration - stores tracking, labels, and pickup data';
