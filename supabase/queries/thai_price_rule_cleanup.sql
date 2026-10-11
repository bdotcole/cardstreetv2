-- Optional one-time cleanup after 20260907_thai_price_rule.sql, for the SQL Editor.
--
-- The rule itself already (a) rewrites every Thai card with a >= 0.99 English twin
-- and (b) removes 10-baht placeholders on cards with no qualifying twin. What it
-- deliberately leaves alone are the rows derived under the OLD multipliers for
-- cards whose mapping confidence is BELOW 0.99 (mostly 0.98 bulbapedia variants and
-- 0.90-0.95 name matches). On 2026-09-05 that was about 1,849 rows with a real-looking
-- value and no qualifying twin. Under the stated policy those are not prices either.
--
-- Preview first, then decide. Both statements skip admin pins and learned rows.

-- 1. Preview what would go.
SELECT mv.card_id, mv.market_avg, mv.source_prices->>'method' AS method,
       (SELECT MAX(confidence_score) FROM public.card_mappings m WHERE m.card_id_th = mv.card_id) AS best_confidence
  FROM public.market_values mv
 WHERE mv.language = 'th' AND mv.condition = 'Raw_NM' AND mv.source = 'api'
   AND NOT EXISTS (
         SELECT 1 FROM public.card_mappings m
          WHERE m.card_id_th = mv.card_id AND m.card_id_en IS NOT NULL AND m.confidence_score >= 0.99)
 ORDER BY mv.market_avg DESC
 LIMIT 100;

-- 2. Remove them (uncomment to run).
-- DELETE FROM public.market_values mv
--  WHERE mv.language = 'th' AND mv.condition = 'Raw_NM' AND mv.source = 'api'
--    AND NOT EXISTS (
--          SELECT 1 FROM public.card_mappings m
--           WHERE m.card_id_th = mv.card_id AND m.card_id_en IS NOT NULL AND m.confidence_score >= 0.99);

-- 3. If 0.98 should count as "99%": re-run the rule at the lower bar instead of deleting.
--    That prices about 2,121 more cards (the bulbapedia variant matches).
-- SELECT * FROM public.apply_thai_price_rule(NULL, 0.98);
