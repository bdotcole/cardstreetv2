-- Multi-game support
-- Adds a `game` dimension to the catalog + pricing tables so the marketplace can
-- carry Magic: The Gathering, Yu-Gi-Oh!, One Piece, Riftbound, and Japanese Pokemon
-- alongside the existing (English/Thai/Japanese) Pokemon catalog.
--
-- Table names are intentionally kept as pokemon_* to avoid a high-risk rename of
-- tables referenced by RLS policies and the market_values FK. The game column is
-- the discriminator; existing rows backfill to 'pokemon'.
--
-- New-game IDs are namespaced by the ingestion scripts (e.g. mtg-<scryfallId>,
-- mtg-set-<code>) so they never collide with Pokemon IDs or each other, which
-- matters because listings.card_id is a plain TEXT column (no FK).

-- Catalog tables ------------------------------------------------------------

ALTER TABLE pokemon_sets
  ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'pokemon';

ALTER TABLE pokemon_cards
  ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'pokemon';

COMMENT ON COLUMN pokemon_sets.game IS 'TCG this set belongs to (pokemon, mtg, yugioh, onepiece, riftbound)';
COMMENT ON COLUMN pokemon_cards.game IS 'TCG this card belongs to (pokemon, mtg, yugioh, onepiece, riftbound)';

-- Composite indexes matching the catalog query shapes:
--   sets:  WHERE game = ? AND language = ? ORDER BY release_date DESC
--   cards: WHERE game = ? AND language = ? (+ set_id)
CREATE INDEX IF NOT EXISTS idx_sets_game_lang_release
  ON pokemon_sets (game, language, release_date DESC);

CREATE INDEX IF NOT EXISTS idx_cards_game_lang_set
  ON pokemon_cards (game, language, set_id);

-- Pricing table -------------------------------------------------------------
-- JustTCG prices vary by condition AND printing (e.g. Normal vs Foil), so a
-- single card/day can hold multiple rows. Add both game (for filtering) and
-- printing (so the daily-unique constraint does not collapse Normal/Foil).

ALTER TABLE market_values
  ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'pokemon';

ALTER TABLE market_values
  ADD COLUMN IF NOT EXISTS printing TEXT;

COMMENT ON COLUMN market_values.game IS 'TCG this price belongs to; mirrors the card''s game';
COMMENT ON COLUMN market_values.printing IS 'JustTCG printing variant (e.g. Normal, Foil); NULL for Pokemon';

-- The market_values.language CHECK currently allows ('en','jp','th'). MTG and the
-- other new games price in 'en', which is already permitted, so no constraint
-- change is needed in Phase 1. Revisit when a game introduces a new language code.

CREATE INDEX IF NOT EXISTS idx_market_values_game ON market_values (game);

-- Rebuild the daily-unique guard to include printing. COALESCE keeps existing
-- Pokemon rows (printing IS NULL) behaving exactly as before: NULL -> '' so the
-- effective key is unchanged for them, while MTG Normal/Foil no longer collide.
DROP INDEX IF EXISTS idx_market_values_unique_daily;
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_values_unique_daily
  ON market_values (card_id, language, condition, COALESCE(printing, ''), DATE(last_updated));
