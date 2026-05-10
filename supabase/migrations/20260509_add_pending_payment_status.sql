-- Add 'pending_payment' and other missing statuses to orders table
-- Required for the Stripe webhook architecture: orders are created with 'pending_payment'
-- and upgraded to 'paid' only after Stripe confirms payment via webhook.

-- Drop the existing check constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Recreate with all statuses used across the codebase
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'pending',
    'pending_payment',
    'paid',
    'awaiting_shipping_payment',
    'label_generated',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'completed',
    'cancelled',
    'disputed'
));

-- Add stripe_payout_id column for idempotent payout tracking in release-funds
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payout_id TEXT DEFAULT NULL;
