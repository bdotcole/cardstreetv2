-- Create the orders table
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
    buyer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    seller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    total_amount NUMERIC NOT NULL,
    platform_fee NUMERIC NOT NULL DEFAULT 0,
    escrow_status TEXT NOT NULL DEFAULT 'held',
    payment_method TEXT,
    payment_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Create the shipping_labels table
CREATE TABLE IF NOT EXISTS public.shipping_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE UNIQUE,
    tracking_number TEXT,
    carrier_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    label_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_labels ENABLE ROW LEVEL SECURITY;

-- Orders Policies
CREATE POLICY "Users can view their own orders as buyer"
    ON public.orders FOR SELECT
    USING (auth.uid() = buyer_id);

CREATE POLICY "Users can view their own orders as seller"
    ON public.orders FOR SELECT
    USING (auth.uid() = seller_id);

CREATE POLICY "Sellers can update their own orders"
    ON public.orders FOR UPDATE
    USING (auth.uid() = seller_id);

-- Shipping Labels Policies
CREATE POLICY "Users can view shipping labels for their orders as buyer"
    ON public.shipping_labels FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = shipping_labels.order_id 
        AND orders.buyer_id = auth.uid()
    ));

CREATE POLICY "Users can view shipping labels for their orders as seller"
    ON public.shipping_labels FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = shipping_labels.order_id 
        AND orders.seller_id = auth.uid()
    ));

CREATE POLICY "Sellers can insert shipping labels for their orders"
    ON public.shipping_labels FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = order_id 
        AND orders.seller_id = auth.uid()
    ));

CREATE POLICY "Sellers can update shipping labels for their orders"
    ON public.shipping_labels FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = order_id 
        AND orders.seller_id = auth.uid()
    ));
