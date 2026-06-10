-- Add shipping payment support to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_payment_id TEXT;

-- Update status constraint to include new shipping-related statuses
-- First drop existing constraint if it exists (might be on public.orders or orders depending on migration history)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'pending', 
    'awaiting_shipping_invoice', 
    'awaiting_shipping_payment', 
    'paid', 
    'label_generated', 
    'shipped', 
    'in_transit', 
    'delivered', 
    'completed', 
    'cancelled', 
    'disputed'
));

-- Add comment for clarity
COMMENT ON COLUMN public.orders.shipping_amount IS 'Amount paid by buyer for shipping (in addition to item price)';
COMMENT ON COLUMN public.orders.shipping_payment_id IS 'Stripe PaymentIntent ID for the shipping portion of the order';
