-- Add shipping_fee to orders for upfront calculation at checkout
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.shipping_fee IS 'Shipping fee calculated at checkout and paid upfront by the buyer.';
