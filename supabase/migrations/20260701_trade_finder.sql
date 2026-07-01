-- Trade Finder (premium): tag collection cards as tradable + shareable trade code.
--
-- v1 is a DISCOVERY tool: users mark cards for trade, share a code/QR, and the
-- matcher proposes value-balanced swaps from the overlap of each side's
-- tradables and wishlists. No trade execution/escrow — users settle via chat
-- or an in-person meet. Matching runs server-side with the service-role client
-- (both sides' rows), so no cross-user RLS is opened here.

-- Cards a user is willing to trade away.
ALTER TABLE collection_items
  ADD COLUMN IF NOT EXISTS for_trade BOOLEAN NOT NULL DEFAULT false;

-- The matcher scans only tradables; most items are not.
CREATE INDEX IF NOT EXISTS idx_collection_items_for_trade
  ON collection_items (collection_id)
  WHERE for_trade;

-- Shareable trade code (rendered as a QR of /trade?code=...). Generated
-- lazily by /api/trade/code the first time a premium user opens the feature.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trade_code TEXT UNIQUE;
