-- Create buylist_requests table
CREATE TABLE IF NOT EXISTS buylist_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_set TEXT,
  card_number TEXT,
  card_rarity TEXT,
  card_image_url TEXT,
  condition TEXT NOT NULL CHECK (condition IN ('M', 'NM', 'LP', 'MP', 'HP', 'DMG')),
  max_price DECIMAL(10,2) NOT NULL CHECK (max_price > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notify_on_availability BOOLEAN DEFAULT true,
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_buylist_user_id ON buylist_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_buylist_status ON buylist_requests(status);
CREATE INDEX IF NOT EXISTS idx_buylist_card_id ON buylist_requests(card_id);
CREATE INDEX IF NOT EXISTS idx_buylist_created_at ON buylist_requests(created_at DESC);

-- Add composite index for common queries
CREATE INDEX IF NOT EXISTS idx_buylist_user_status ON buylist_requests(user_id, status);

-- Enable Row Level Security
ALTER TABLE buylist_requests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own buylist requests" ON buylist_requests;
DROP POLICY IF EXISTS "Users can create own buylist requests" ON buylist_requests;
DROP POLICY IF EXISTS "Users can update own buylist requests" ON buylist_requests;
DROP POLICY IF EXISTS "Users can delete own buylist requests" ON buylist_requests;

-- RLS Policy: Users can view their own buylist requests
CREATE POLICY "Users can view own buylist requests"
  ON buylist_requests FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can create their own buylist requests
CREATE POLICY "Users can create own buylist requests"
  ON buylist_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own buylist requests
CREATE POLICY "Users can update own buylist requests"
  ON buylist_requests FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own buylist requests
CREATE POLICY "Users can delete own buylist requests"
  ON buylist_requests FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_buylist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function
DROP TRIGGER IF EXISTS update_buylist_updated_at_trigger ON buylist_requests;
CREATE TRIGGER update_buylist_updated_at_trigger
  BEFORE UPDATE ON buylist_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_buylist_updated_at();

-- Add comments for documentation
COMMENT ON TABLE buylist_requests IS 'Stores user requests for cards not currently available on the marketplace';
COMMENT ON COLUMN buylist_requests.user_id IS 'Reference to the user who created the buylist request';
COMMENT ON COLUMN buylist_requests.card_id IS 'Unique identifier for the card';
COMMENT ON COLUMN buylist_requests.condition IS 'Desired card condition (M=Mint, NM=Near Mint, LP=Lightly Played, MP=Moderately Played, HP=Heavily Played, DMG=Damaged)';
COMMENT ON COLUMN buylist_requests.max_price IS 'Maximum price the user is willing to pay in the specified currency';
COMMENT ON COLUMN buylist_requests.status IS 'Current status of the buylist request';
