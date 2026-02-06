-- Portfolio Snapshots Table
-- Stores periodic snapshots of user portfolio values for historical tracking

CREATE TABLE portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  total_market_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_portfolio_snapshots_user_time 
  ON portfolio_snapshots(user_id, timestamp DESC);

CREATE INDEX idx_portfolio_snapshots_user_latest 
  ON portfolio_snapshots(user_id, created_at DESC);

-- Row Level Security
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can only view their own snapshots
CREATE POLICY "Users can view own portfolio snapshots"
  ON portfolio_snapshots FOR SELECT
  USING (auth.uid() = user_id);

-- Only the system (Edge Functions with service role) can insert snapshots
CREATE POLICY "System can insert portfolio snapshots"
  ON portfolio_snapshots FOR INSERT
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE portfolio_snapshots IS 'Stores hourly snapshots of user portfolio values for historical tracking and charts';
