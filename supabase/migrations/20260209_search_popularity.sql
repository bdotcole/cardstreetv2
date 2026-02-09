-- Search Popularity Tracking
-- Tracks which cards users search for to enable intelligent ranking

-- Create search popularity table
CREATE TABLE IF NOT EXISTS search_popularity (
  card_id TEXT PRIMARY KEY REFERENCES pokemon_cards(id) ON DELETE CASCADE,
  search_count INTEGER DEFAULT 1,
  last_searched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_search_popularity_count ON search_popularity(search_count DESC);
CREATE INDEX IF NOT EXISTS idx_search_popularity_last_searched ON search_popularity(last_searched_at DESC);

-- Function to increment search popularity
CREATE OR REPLACE FUNCTION increment_search_popularity(p_card_id TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO search_popularity (card_id, search_count, last_searched_at)
  VALUES (p_card_id, 1, NOW())
  ON CONFLICT (card_id) 
  DO UPDATE SET 
    search_count = search_popularity.search_count + 1,
    last_searched_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to decay search counts over time (optional - can run monthly)
CREATE OR REPLACE FUNCTION decay_search_popularity()
RETURNS VOID AS $$
BEGIN
  -- Reduce search counts by 50% for cards not searched in 30 days
  UPDATE search_popularity
  SET search_count = GREATEST(1, FLOOR(search_count * 0.5))
  WHERE last_searched_at < NOW() - INTERVAL '30 days';
  
  -- Delete entries with very low counts (< 2) older than 90 days
  DELETE FROM search_popularity
  WHERE search_count < 2 
    AND last_searched_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Create view for popular cards
CREATE OR REPLACE VIEW popular_cards AS
SELECT 
  c.*,
  sp.search_count,
  sp.last_searched_at
FROM pokemon_cards c
INNER JOIN search_popularity sp ON c.id = sp.card_id
ORDER BY sp.search_count DESC, sp.last_searched_at DESC
LIMIT 100;

-- Comments
COMMENT ON TABLE search_popularity IS 'Tracks search popularity for intelligent card ranking';
COMMENT ON COLUMN search_popularity.search_count IS 'Number of times this card has been searched';
COMMENT ON COLUMN search_popularity.last_searched_at IS 'Last time this card appeared in search results';
