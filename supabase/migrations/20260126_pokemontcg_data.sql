-- Pokemon TCG Data Migration - Cards and Sets
-- This migration creates tables to store Pokemon card and set data locally

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For full-text search

-- Pokemon Sets Table
CREATE TABLE pokemon_sets (
  id TEXT PRIMARY KEY, -- Set ID from API (e.g., 'base1', 'sv4pt5')
  name TEXT NOT NULL,
  series TEXT,
  printed_total INTEGER,
  total INTEGER,
  release_date DATE,
  symbol_url TEXT,
  logo_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pokemon Cards Table
CREATE TABLE pokemon_cards (
  id TEXT PRIMARY KEY, -- Card ID from API (e.g., 'sv4pt5-234')
  name TEXT NOT NULL,
  set_id TEXT REFERENCES pokemon_sets(id) ON DELETE CASCADE,
  number TEXT,
  supertype TEXT, -- 'Pokémon', 'Trainer', 'Energy'
  subtypes TEXT[], -- Array of subtypes
  rarity TEXT,
  hp INTEGER,
  types TEXT[], -- Array of types (e.g., ['Psychic'])
  attacks JSONB, -- Attack data with cost, damage, text
  weaknesses JSONB,
  resistances JSONB,
  retreat_cost TEXT[], -- Array of retreat cost types
  abilities JSONB,
  rules TEXT[],
  regulation_mark TEXT, -- e.g., 'G', 'H'
  image_small TEXT,
  image_large TEXT,
  tcgplayer_url TEXT,
  cardmarket_url TEXT,
  raw_data JSONB, -- Full API response for future-proofing and price data
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance optimization
CREATE INDEX idx_sets_release_date ON pokemon_sets(release_date DESC);
CREATE INDEX idx_sets_series ON pokemon_sets(series);
CREATE INDEX idx_sets_name ON pokemon_sets(name);

CREATE INDEX idx_cards_name ON pokemon_cards(name);
CREATE INDEX idx_cards_set_id ON pokemon_cards(set_id);
CREATE INDEX idx_cards_rarity ON pokemon_cards(rarity);
CREATE INDEX idx_cards_supertype ON pokemon_cards(supertype);
CREATE INDEX idx_cards_types ON pokemon_cards USING GIN(types);
CREATE INDEX idx_cards_subtypes ON pokemon_cards USING GIN(subtypes);

-- Full-text search index using trigram for fuzzy matching
CREATE INDEX idx_cards_name_trgm ON pokemon_cards USING GIN(name gin_trgm_ops);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pokemon_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_pokemon_sets_updated_at
  BEFORE UPDATE ON pokemon_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_pokemon_updated_at();

CREATE TRIGGER update_pokemon_cards_updated_at
  BEFORE UPDATE ON pokemon_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_pokemon_updated_at();

-- Row Level Security (RLS) Policies
-- Enable RLS on both tables
ALTER TABLE pokemon_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pokemon_cards ENABLE ROW LEVEL SECURITY;

-- Allow public read access (no authentication required)
CREATE POLICY "Pokemon sets are viewable by everyone"
  ON pokemon_sets FOR SELECT
  USING (true);

CREATE POLICY "Pokemon cards are viewable by everyone"
  ON pokemon_cards FOR SELECT
  USING (true);

-- Optional: Create view for simplified card queries
CREATE OR REPLACE VIEW pokemon_cards_simple AS
SELECT 
  id,
  name,
  set_id,
  number,
  supertype,
  rarity,
  hp,
  types,
  image_small,
  image_large,
  (raw_data->'tcgplayer'->'prices') as price_data
FROM pokemon_cards;

-- Create a helper function to search cards
CREATE OR REPLACE FUNCTION search_pokemon_cards(
  search_query TEXT,
  result_limit INTEGER DEFAULT 30
)
RETURNS SETOF pokemon_cards AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM pokemon_cards
  WHERE 
    name ILIKE '%' || search_query || '%'
    OR id ILIKE '%' || search_query || '%'
  ORDER BY 
    -- Prioritize exact matches
    CASE WHEN LOWER(name) = LOWER(search_query) THEN 1 ELSE 2 END,
    -- Then by similarity
    similarity(name, search_query) DESC,
    -- Then by release date (newer first via set join)
    set_id DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;
