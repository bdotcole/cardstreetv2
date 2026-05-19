-- Perceptual-hash (dHash) based card image matching.
-- See scripts/backfill-phashes.mjs for the producer; see services/scannerService.ts for the consumer.

ALTER TABLE pokemon_cards
  ADD COLUMN IF NOT EXISTS phash bytea;

COMMENT ON COLUMN pokemon_cards.phash IS '64-bit dHash of image_large (8 bytes). Built from 9x8 grayscale via Brian Kernighan-style row comparisons.';

CREATE INDEX IF NOT EXISTS idx_pokemon_cards_phash_present
  ON pokemon_cards (language)
  WHERE phash IS NOT NULL;

-- Hamming distance between two equal-length bytea values.
-- PG 14+ ships bit_count(bytea) natively; we just need to XOR byte-by-byte first.
CREATE OR REPLACE FUNCTION hamming_distance(a bytea, b bytea)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
DECLARE
  i int;
  xored bytea := a;
BEGIN
  IF octet_length(a) <> octet_length(b) THEN
    RAISE EXCEPTION 'hamming_distance: byte length mismatch (% vs %)', octet_length(a), octet_length(b);
  END IF;
  FOR i IN 0..octet_length(a) - 1 LOOP
    xored := set_byte(xored, i, get_byte(a, i) # get_byte(b, i));
  END LOOP;
  RETURN bit_count(xored)::int;
END;
$$;

-- Top-N pHash neighbour search. Sequential scan + popcount; ~25k rows runs <300ms.
CREATE OR REPLACE FUNCTION search_pokemon_by_phash(
  query_phash bytea,
  max_distance int DEFAULT 16,
  result_limit int DEFAULT 10,
  language_filter text DEFAULT NULL
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
  raw_data jsonb,
  distance int
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT id, name, english_name, set_id, number, rarity, supertype,
         image_small, image_large, language, raw_data, distance
  FROM (
    SELECT pc.id, pc.name, pc.english_name, pc.set_id, pc.number, pc.rarity, pc.supertype,
           pc.image_small, pc.image_large, pc.language, pc.raw_data,
           hamming_distance(pc.phash, query_phash) AS distance
    FROM pokemon_cards pc
    WHERE pc.phash IS NOT NULL
      AND (language_filter IS NULL OR pc.language = language_filter)
  ) sub
  WHERE distance <= max_distance
  ORDER BY distance ASC, set_id DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION search_pokemon_by_phash(bytea, int, int, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hamming_distance(bytea, bytea) TO anon, authenticated, service_role;
