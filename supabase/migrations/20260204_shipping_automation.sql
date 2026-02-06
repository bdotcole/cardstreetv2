-- Shipping Automation & Buyer Protection Schema
-- This migration adds tables for SHIPPOP integration and escrow-based buyer protection

-- Orders table (replaces/extends transactions for shipping)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  buyer_id UUID REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  seller_id UUID REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  
  -- Shipping details
  shipping_address_id UUID REFERENCES shipping_addresses(id) ON DELETE SET NULL,
  
  -- Order status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'paid', 'label_generated', 'shipped', 
    'in_transit', 'delivered', 'completed', 'cancelled', 'disputed'
  )),
  
  -- Payment/Escrow
  total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount > 0),
  platform_fee DECIMAL(10,2) DEFAULT 0,
  escrow_status TEXT DEFAULT 'held' CHECK (escrow_status IN (
    'held', 'released', 'refunded'
  )),
  funds_release_at TIMESTAMPTZ, -- Delivery + 48 hours
  
  -- Payment details
  payment_method TEXT CHECK (payment_method IN ('promptpay', 'truemoney', 'credit_card', 'paypal')),
  payment_id TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Shipping labels table (SHIPPOP integration)
CREATE TABLE IF NOT EXISTS shipping_labels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  -- SHIPPOP response data
  tracking_number TEXT NOT NULL,
  label_url TEXT NOT NULL,
  carrier_name TEXT NOT NULL,
  
  -- Tracking status
  status TEXT DEFAULT 'created' CHECK (status IN (
    'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed'
  )),
  
  -- Additional SHIPPOP metadata
  shippop_purchase_id TEXT,
  courier_tracking_url TEXT,
  estimated_delivery_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shipping addresses table (Thai address validation)
CREATE TABLE IF NOT EXISTS shipping_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Recipient info
  recipient_name TEXT NOT NULL,
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^[0-9]{9,10}$'),
  
  -- Thai address components
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  sub_district TEXT NOT NULL, -- ตำบล/แขวง
  district TEXT NOT NULL, -- อำเภอ/เขต
  province TEXT NOT NULL, -- จังหวัด
  postal_code TEXT NOT NULL CHECK (postal_code ~ '^\d{5}$'),
  
  -- Metadata
  is_default BOOLEAN DEFAULT false,
  address_type TEXT DEFAULT 'shipping' CHECK (address_type IN ('shipping', 'billing')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_escrow_status ON orders(escrow_status);
CREATE INDEX IF NOT EXISTS idx_orders_funds_release_at ON orders(funds_release_at) WHERE escrow_status = 'held';

CREATE INDEX IF NOT EXISTS idx_shipping_labels_order_id ON shipping_labels(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_tracking_number ON shipping_labels(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_status ON shipping_labels(status);

CREATE INDEX IF NOT EXISTS idx_shipping_addresses_user_id ON shipping_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_shipping_addresses_default ON shipping_addresses(user_id, is_default) WHERE is_default = true;

-- Enable Row Level Security
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_addresses ENABLE ROW LEVEL SECURITY;

-- RLS Policies for orders
CREATE POLICY "Users can view own orders as buyer or seller"
  ON orders FOR SELECT
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "Buyers can create orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Buyers and sellers can update orders"
  ON orders FOR UPDATE
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- RLS Policies for shipping labels
CREATE POLICY "Users can view shipping labels for their orders"
  ON shipping_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = shipping_labels.order_id
      AND (orders.buyer_id = auth.uid() OR orders.seller_id = auth.uid())
    )
  );

CREATE POLICY "System can create shipping labels"
  ON shipping_labels FOR INSERT
  WITH CHECK (true); -- Edge Function creates labels

CREATE POLICY "System can update shipping labels"
  ON shipping_labels FOR UPDATE
  USING (true); -- Webhook updates labels

-- RLS Policies for shipping addresses
CREATE POLICY "Users can view own addresses"
  ON shipping_addresses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own addresses"
  ON shipping_addresses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own addresses"
  ON shipping_addresses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own addresses"
  ON shipping_addresses FOR DELETE
  USING (auth.uid() = user_id);

-- Triggers for updated_at
CREATE TRIGGER update_orders_updated_at 
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shipping_labels_updated_at 
  BEFORE UPDATE ON shipping_labels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shipping_addresses_updated_at 
  BEFORE UPDATE ON shipping_addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure only one default address per user
CREATE OR REPLACE FUNCTION ensure_single_default_address()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE shipping_addresses
    SET is_default = false
    WHERE user_id = NEW.user_id
    AND id != NEW.id
    AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_default_address_trigger
  BEFORE INSERT OR UPDATE ON shipping_addresses
  FOR EACH ROW EXECUTE FUNCTION ensure_single_default_address();
