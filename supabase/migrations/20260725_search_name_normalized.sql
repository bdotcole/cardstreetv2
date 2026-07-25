-- Space-insensitive card search.
--
-- The Thai catalog is inconsistent about spacing before card suffixes:
-- M-P-era rows store "โครแบทex" while MA1-era rows store "โครแบท ex", and
-- users type both. Raw ILIKE is whitespace-literal, so a spacing mismatch
-- hides the card (verified 2026-07-25: "โครแบท ex" missed SV-P-255,
-- "ไรโค v" returned zero rows).
--
-- These generated columns hold lowercased, space-stripped copies of the name
-- fields. services/pokemonService.ts searches them alongside the raw columns
-- with a space-stripped query, normalizing both sides of the comparison. The
-- client probes for the columns at runtime and degrades to raw-column search
-- while this migration is unapplied, so ordering of deploy vs. migration
-- doesn't matter.
ALTER TABLE pokemon_cards
  ADD COLUMN IF NOT EXISTS search_name text
    GENERATED ALWAYS AS (lower(replace(name, ' ', ''))) STORED,
  ADD COLUMN IF NOT EXISTS search_english_name text
    GENERATED ALWAYS AS (lower(replace(english_name, ' ', ''))) STORED;
