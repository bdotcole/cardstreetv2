-- Indexes for the Marketplace search hot path.
--
-- The active-listings GET filters on card_data->>name with ILIKE plus price
-- range plus language; without these the planner does a sequential scan over
-- every listing. The trigram index supports ILIKE / partial-match efficiently.
-- pg_trgm is already enabled in this project (used by other tables) but the
-- CREATE EXTENSION is idempotent and safe.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on the JSON-extracted card name. Targets:
--   ilike('card_data->>name', '%charizard%')
CREATE INDEX IF NOT EXISTS idx_listings_card_name_trgm
    ON public.listings
    USING gin ((card_data->>'name') gin_trgm_ops)
    WHERE status = 'active';

-- B-tree on (status, price) so the price-range filter on active listings is
-- index-driven. The partial-index condition matches the dominant query.
CREATE INDEX IF NOT EXISTS idx_listings_active_price
    ON public.listings (price)
    WHERE status = 'active';

-- Language filter on card_data->>language with status='active'.
CREATE INDEX IF NOT EXISTS idx_listings_active_language
    ON public.listings ((card_data->>'language'))
    WHERE status = 'active';

-- Composite to speed "newest active listings" — the default sort.
CREATE INDEX IF NOT EXISTS idx_listings_active_created
    ON public.listings (created_at DESC)
    WHERE status = 'active';
