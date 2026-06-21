-- Make the pHash neighbour search multi-game aware.
--
-- The catalog now holds 6 games in pokemon_cards keyed by `game`. The scanner's
-- pHash path is inherently game-agnostic (artworks never collide across games), but
-- the RPC had two gaps:
--   1. It never returned `game`, so every pHash match was mapped as game='pokemon'
--      downstream (mapSupabaseCardToInternal defaults to 'pokemon' when game is absent)
--      — a real mislabel bug for MTG/Yu-Gi-Oh/One Piece/Riftbound/Lorcana matches.
--   2. It couldn't be narrowed to a single game when the model is confident about it.
--
-- Adding a column to a function's RETURNS TABLE requires DROP + CREATE (not REPLACE).
-- Callers pass named params, so the new trailing `game_filter` (defaulted) is backward
-- compatible with the existing 4-arg call site in services/scannerService.ts.

DROP FUNCTION IF EXISTS search_pokemon_by_phash(bytea, int, int, text);

CREATE FUNCTION search_pokemon_by_phash(
  query_phash bytea,
  max_distance int DEFAULT 16,
  result_limit int DEFAULT 10,
  language_filter text DEFAULT NULL,
  game_filter text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  name text,
  english_name text,
  set_id text,
  number text,
  rarity text,
  supertype text,
  image_small text,
  image_large text,
  language text,
  game text,
  raw_data jsonb,
  distance int
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT id, name, english_name, set_id, number, rarity, supertype,
         image_small, image_large, language, game, raw_data, distance
  FROM (
    SELECT pc.id, pc.name, pc.english_name, pc.set_id, pc.number, pc.rarity, pc.supertype,
           pc.image_small, pc.image_large, pc.language, pc.game, pc.raw_data,
           hamming_distance(pc.phash, query_phash) AS distance
    FROM pokemon_cards pc
    WHERE pc.phash IS NOT NULL
      AND (language_filter IS NULL OR pc.language = language_filter)
      AND (game_filter IS NULL OR pc.game = game_filter)
  ) sub
  WHERE distance <= max_distance
  ORDER BY distance ASC, set_id DESC
  LIMIT result_limit;
$$;

-- Match the linter hardening applied to the previous signature (20260605_linter_hardening.sql).
ALTER FUNCTION public.search_pokemon_by_phash(
  query_phash bytea, max_distance integer, result_limit integer, language_filter text, game_filter text
) SET search_path = public, pg_temp;

-- Helps the game_filter leg; mirrors idx_pokemon_cards_phash_present (which indexes language).
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_phash_game_present
  ON pokemon_cards (game)
  WHERE phash IS NOT NULL;

GRANT EXECUTE ON FUNCTION search_pokemon_by_phash(bytea, int, int, text, text) TO anon, authenticated, service_role;
