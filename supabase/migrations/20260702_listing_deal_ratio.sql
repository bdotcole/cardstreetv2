-- Best-deals sort for the marketplace.
--
-- deal_ratio = price / card_data->>'marketPrice' (the THB market snapshot
-- written at listing creation and re-synced by the monthly mirror cron).
-- < 1.0 means priced below market; NULL when the snapshot has no usable
-- market price. A generated column (not a view/RPC) so PostgREST can
-- ORDER BY it directly from supabase-js with correct pagination.
--
-- The regex guard keeps the cast from ever raising on legacy rows where
-- marketPrice is missing or non-numeric; those rows sort last (NULL).
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS deal_ratio NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN (card_data->>'marketPrice') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (card_data->>'marketPrice')::numeric > 0
      THEN price / (card_data->>'marketPrice')::numeric
      ELSE NULL
    END
  ) STORED;

-- Browse is always status='active'; ASC puts NULLs last by default.
CREATE INDEX IF NOT EXISTS idx_listings_active_deal_ratio
  ON listings (deal_ratio)
  WHERE status = 'active';
