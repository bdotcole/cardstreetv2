-- Performance optimization indexes for pokemon_cards search
-- Run this in your Supabase SQL Editor

-- 1. Index on name for faster ILIKE searches (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_name_lower 
ON pokemon_cards (LOWER(name));

-- 2. Index on language for filtering
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_language 
ON pokemon_cards (language);

-- 3. Composite index for language + name searches
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_lang_name 
ON pokemon_cards (language, LOWER(name));

-- 4. Index on supertype for Pokemon filtering
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_supertype 
ON pokemon_cards (supertype);

-- 5. GIN index for full-text search (optional but powerful)
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_name_gin 
ON pokemon_cards USING gin (to_tsvector('english', name));

-- Analyze tables to update statistics
ANALYZE pokemon_cards;
