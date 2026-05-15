-- ============================================================
-- CardStreet Performance Indexes
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Hot path: every marketplace load filters by status + sorts by created_at
--    This partial index only covers active listings (by far the most queried subset)
CREATE INDEX IF NOT EXISTS idx_listings_active_recent
    ON listings(created_at DESC)
    WHERE status = 'active';

-- 2. Seller dashboard: fetch all listings for a specific seller
CREATE INDEX IF NOT EXISTS idx_listings_seller_id
    ON listings(seller_id);

-- 3. Card lookups from Explore page (listing overlay)
CREATE INDEX IF NOT EXISTS idx_listings_card_id
    ON listings(card_id);

-- 4. Price range filters (server-side filtering now active)
CREATE INDEX IF NOT EXISTS idx_listings_price
    ON listings(price)
    WHERE status = 'active';

-- 5. JSONB index for server-side card name search (ilike on card_data->>name)
--    This enables faster ILIKE scans on the extracted text field
CREATE INDEX IF NOT EXISTS idx_listings_card_name
    ON listings((card_data->>'name'));

-- 6. JSONB index for language filter
CREATE INDEX IF NOT EXISTS idx_listings_card_language
    ON listings((card_data->>'language'))
    WHERE status = 'active';

-- 7. Portfolio snapshots: per-user time-range queries
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_time
    ON portfolio_snapshots(user_id, timestamp DESC);

-- 8. Collection items: JOIN via collection_id (used in portfolio history)
CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id
    ON collection_items(collection_id);

-- 9. Orders: seller dashboard order history
CREATE INDEX IF NOT EXISTS idx_orders_seller_id
    ON orders(seller_id, created_at DESC);

-- 10. Orders: buyer order status page
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id
    ON orders(buyer_id, created_at DESC);

-- ============================================================
-- After creating indexes, analyze the tables so the query
-- planner uses them immediately:
-- ============================================================
ANALYZE listings;
ANALYZE portfolio_snapshots;
ANALYZE collection_items;
ANALYZE orders;
