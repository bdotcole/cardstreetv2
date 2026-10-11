-- Search and scanner database work from the 2026-09 audit.
--
-- 1. english_name trigram index. `name` has had a GIN trigram index since
--    20260126; english_name only had a lower() btree, which cannot serve the
--    leading-wildcard ILIKE every English-language search runs, so those did a
--    sequential scan over ~117k rows. Plain CREATE INDEX (not CONCURRENTLY) so it
--    can run from the SQL Editor; the lock lasts a few seconds at this table size.
--
-- 2. search_cards_fuzzy: pg_trgm nearest-name lookup, called by
--    services/pokemonService.ts only when the exact substring pass returns fewer
--    than three rows, so "charizrd" and Thai spelling variants stop dead-ending.
--    Returns ids and a similarity score; the service re-fetches the rows through
--    its normal scoped query so embeds and mapping stay in one place.
--
-- 3. search_pokemon_by_phash: same signature and return columns, but raw_data is
--    now just the three keys the card mapper reads (tcgplayer, images, set)
--    instead of the whole multi-kilobyte blob per candidate. CREATE OR REPLACE is
--    allowed because the RETURNS TABLE is unchanged.
--
-- Run in the Supabase SQL Editor. Everything is idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cards_english_name_trgm
  ON public.pokemon_cards USING GIN (english_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_cards_fuzzy(
  p_query text,
  p_limit int DEFAULT 30
)
RETURNS TABLE (id text, sim real)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT pc.id,
         GREATEST(similarity(pc.name, p_query),
                  similarity(COALESCE(pc.english_name, ''), p_query)) AS sim
    FROM public.pokemon_cards pc
   WHERE pc.name % p_query
      OR COALESCE(pc.english_name, '') % p_query
   ORDER BY sim DESC
   LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

ALTER FUNCTION public.search_cards_fuzzy(text, int) SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.search_cards_fuzzy(text, int) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION search_pokemon_by_phash(
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
           pc.image_small, pc.image_large, pc.language, pc.game,
           -- Only what lib/cardMapper.ts reads: the price fallback and the image/set fallbacks.
           jsonb_build_object(
             'tcgplayer', pc.raw_data->'tcgplayer',
             'images',    pc.raw_data->'images',
             'set',       pc.raw_data->'set'
           ) AS raw_data,
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

ALTER FUNCTION public.search_pokemon_by_phash(
  query_phash bytea, max_distance integer, result_limit integer, language_filter text, game_filter text
) SET search_path = public, pg_temp;
