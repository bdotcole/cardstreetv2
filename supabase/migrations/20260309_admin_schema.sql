-- Admin Schema Migration
-- Adds role-based access, partner download tracking, and support tickets

-- 1. Add role + download_count to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'
    CHECK (role IN ('user', 'partner', 'admin')),
  ADD COLUMN IF NOT EXISTS total_downloads INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_qr_slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS partner_level INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS partner_fee DECIMAL(5,3) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS partner_joined_at TIMESTAMPTZ;

-- 2. Partner download events (time-series analytics)
CREATE TABLE IF NOT EXISTS partner_downloads (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id   UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  downloaded_at TIMESTAMPTZ DEFAULT NOW(),
  device_type  TEXT,
  country      TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_downloads_partner_id ON partner_downloads(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_downloads_downloaded_at ON partner_downloads(downloaded_at);

-- 3. Support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT DEFAULT 'General'
    CHECK (category IN ('Technical', 'Billing', 'Card Valuation', 'General')),
  status       TEXT DEFAULT 'Open'
    CHECK (status IN ('Open', 'In Progress', 'Resolved')),
  admin_reply  TEXT,
  replied_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  replied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_downloads ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view/create their own tickets
CREATE POLICY "Users can view own tickets"
  ON support_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS: Admins can do everything with tickets (via service_role key, bypasses RLS)
-- partner_downloads: only writable/readable via service_role
CREATE POLICY "No public access to partner_downloads"
  ON partner_downloads FOR SELECT
  USING (false);

-- Auto-update updated_at on support_tickets
CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
