-- Add completed_at column to public.orders table
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
