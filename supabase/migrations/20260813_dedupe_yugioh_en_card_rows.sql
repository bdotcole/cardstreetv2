-- Remove duplicate Yu-Gi-Oh card rows: the "-enNNN" copies of vintage cards that
-- already exist under the bare "-NNN" id.
--
-- WHAT THESE ARE
-- --------------
-- Seven vintage sets were ingested (all in one pass, 2026-06-06T01:37:29) with the
-- same card emitted under more than one id convention:
--     ygo-lob-027    North American print   "Aqua Madoor LOB-027"
--     ygo-lob-en027  English print          <- identical row, the duplicate
--     ygo-lob-e021   European print         "Aqua Madoor LOB-E021"  <- NOT a duplicate
-- The European rows carry their own numbering and their own price ($2.35 vs $0.96
-- for Aqua Madoor), so they are a genuinely different printing and are LEFT ALONE.
-- The "-en" rows are byte-identical to their bare twin in name, number and rarity —
-- verified for all 755, with 0 exceptions — and only inflate search results.
--
-- SAFETY, measured on the live DB 2026-08-13 before writing this:
--   * user data referencing these ids: listings 0, collection_items 0, wishlists 0.
--   * 753 of the 755 bare twins already carry a Raw_NM price, and there is NOT ONE
--     "-en" row holding a price its twin lacks — so no price is lost.
--   * their market_values (~519) and price_snapshots (~7,249) rows are derived data
--     that the nightly crons and the PriceCharting ingest regenerate; they are
--     removed here so nothing is orphaned.
--
-- 43 "-en" rows whose twin DIFFERS (Dark Crisis prints several cards as both Common
-- and Short Print) are deliberately excluded by the rarity check — those are real
-- distinct printings. The ~24,417 modern "-en" rows with no bare twin are untouched;
-- "-en" is the normal shape for modern sets.
--
-- Run in the Supabase SQL Editor, top to bottom. Statement 1 only builds a worklist,
-- so you can inspect it before anything is deleted. Safe to re-run.

-- ===== 1. Build the worklist (deletes nothing) =====
DROP TABLE IF EXISTS public._ygo_redundant_en;
CREATE TABLE public._ygo_redundant_en AS
SELECT en.id
FROM public.pokemon_cards en
JOIN public.pokemon_cards na
  ON  na.set_id = en.set_id
  AND na.id     = en.set_id || '-' || substring(en.id from length(en.set_id) + 4)
  AND na.name   = en.name
  AND na.number = en.number
  AND na.rarity IS NOT DISTINCT FROM en.rarity
WHERE en.game = 'yugioh'
  AND en.id LIKE en.set_id || '-en%'
  AND substring(en.id from length(en.set_id) + 4) ~ '^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM public.listings         l  WHERE l.card_id  = en.id)
  AND NOT EXISTS (SELECT 1 FROM public.collection_items ci WHERE ci.card_id = en.id)
  AND NOT EXISTS (SELECT 1 FROM public.wishlists        w  WHERE w.card_id  = en.id);

-- ===== 2. Inspect before deleting — expect 755 rows across 8 sets =====
SELECT count(*) AS rows_to_delete FROM public._ygo_redundant_en;

SELECT c.set_id, count(*) AS n
FROM public.pokemon_cards c
JOIN public._ygo_redundant_en r ON r.id = c.id
GROUP BY c.set_id
ORDER BY n DESC;

-- ===== 3. Remove derived data first, so nothing is orphaned =====
DELETE FROM public.price_snapshots
WHERE subject_id IN (SELECT id FROM public._ygo_redundant_en);

DELETE FROM public.market_values
WHERE card_id IN (SELECT id FROM public._ygo_redundant_en);

-- ===== 4. Remove the duplicate card rows =====
DELETE FROM public.pokemon_cards
WHERE id IN (SELECT id FROM public._ygo_redundant_en);

-- ===== 5. Verify — both should return 0 =====
SELECT count(*) AS surviving_duplicates
FROM public.pokemon_cards c
JOIN public._ygo_redundant_en r ON r.id = c.id;

SELECT count(*) AS orphaned_prices
FROM public.market_values m
JOIN public._ygo_redundant_en r ON r.id = m.card_id;

-- Spot-check: the bare twin survives and is priced. Expect one row, ~$0.96.
SELECT c.id, c.name, c.number, m.market_avg, m.currency
FROM public.pokemon_cards c
LEFT JOIN public.market_values m ON m.card_id = c.id AND m.condition = 'Raw_NM'
WHERE c.set_id = 'ygo-lob' AND c.name = 'Aqua Madoor';

-- ===== 6. Clean up the worklist =====
DROP TABLE public._ygo_redundant_en;
