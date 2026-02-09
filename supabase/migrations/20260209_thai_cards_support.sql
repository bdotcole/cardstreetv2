-- Add support for Thai cards with English names
-- Migration: 20260209_thai_cards_support.sql

-- Add english_name column to pokemon_cards table
ALTER TABLE pokemon_cards 
ADD COLUMN IF NOT EXISTS english_name TEXT;

-- Add language column to pokemon_cards table (if not exists)
ALTER TABLE pokemon_cards 
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Add language column to pokemon_sets table (if not exists)
ALTER TABLE pokemon_sets 
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Create index for English name searches
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_english_name_lower 
ON pokemon_cards (LOWER(english_name));

-- Create composite index for english_name + language
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_lang_english_name 
ON pokemon_cards (language, LOWER(english_name));

-- Update the search function to include english_name
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
    OR COALESCE(english_name, '') ILIKE '%' || search_query || '%'
    OR id ILIKE '%' || search_query || '%'
  ORDER BY 
    -- Prioritize exact matches
    CASE 
      WHEN LOWER(name) = LOWER(search_query) THEN 1 
      WHEN LOWER(COALESCE(english_name, '')) = LOWER(search_query) THEN 2
      ELSE 3 
    END,
    -- Then by similarity
    GREATEST(
      similarity(name, search_query),
      similarity(COALESCE(english_name, ''), search_query)
    ) DESC,
    -- Then by release date
    set_id DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comment explaining the columns
COMMENT ON COLUMN pokemon_cards.english_name IS 'English name of the card for non-English cards (e.g., Thai cards)';
COMMENT ON COLUMN pokemon_cards.language IS 'Language code of the card (e.g., en, th, ja)';
COMMENT ON COLUMN pokemon_sets.language IS 'Language code of the set (e.g., en, th, ja)';
