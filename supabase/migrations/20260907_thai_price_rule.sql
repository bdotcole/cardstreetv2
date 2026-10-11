-- Thai singles pricing rule (founder policy, 2026-09-07).
--
-- There is no central Thai price source, so a Thai single is valued from its
-- English twin until CardStreet has enough of its own sales. The rule:
--
--   base      = 0.60 x the English twin's market price (in THB), and ONLY when the
--               card_mappings row has confidence_score >= 0.99 and an English twin.
--   override  = if at least one non-snipe in-app sale of the Thai card is at or
--               above base, the most recent such sale IS the price;
--               else if there are >= 3 non-snipe sales below base, the average
--               of those sales is the price;
--               else the price is base.
--   untouched = rows an admin pinned (market_values.source = 'admin').
--   unpriced  = a Thai card with no qualifying twin gets NO row. The old 10-baht
--               placeholder that daily-market-update used to write for such cards
--               is removed here, because a floor constant rendered as a market
--               price is what made real listings look 10-120x overpriced.
--
-- "Non-snipe" = at or above the public listing floor (market_value_sale_floor_thb(),
-- 20 baht), the same test every internal recompute uses. Only Raw_NM sales count:
-- the headline row is the Raw_NM key and a played or graded sale is a different key.
--
-- The THB rate is 1 / EXCHANGE_RATES.USD (0.028), the rate lib/cardMapper.ts uses to
-- render English prices, so a Thai card displays as exactly 60% of the English
-- price shown elsewhere on the site.
--
-- Writers: app/api/cron/recompute-thai-prices (daily, whole catalog),
-- lib/internalPricing.ts (per Thai sale), and supabase/functions/daily-market-update
-- (per newly seen Thai card). All three call this one function.
--
-- Run in the Supabase SQL Editor. Safe to re-run; writes are idempotent.

CREATE OR REPLACE FUNCTION public.apply_thai_price_rule(
  p_card_id        TEXT    DEFAULT NULL,   -- one Thai card, or NULL for every mapped Thai card
  p_min_confidence NUMERIC DEFAULT 0.99,
  p_ratio          NUMERIC DEFAULT 0.60
) RETURNS TABLE (
  written              INT,
  from_base            INT,
  from_sale_above      INT,
  from_sales_avg_below INT,
  placeholders_removed INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_thb_per_usd CONSTANT NUMERIC := 1 / 0.028;
  v_floor       NUMERIC := public.market_value_sale_floor_thb();
  v_written     INT := 0;
  v_base        INT := 0;
  v_above       INT := 0;
  v_avg         INT := 0;
  v_removed     INT := 0;
BEGIN
  -- Trusted internal write: the clobber guard passes these rows through so the
  -- rule can also revert a 'cardstreet' row that a single below-base sale set
  -- under the older first-sale rule.
  PERFORM set_config('cardstreet.internal_write', 'on', true);

  DROP TABLE IF EXISTS tmp_thai_rule;
  CREATE TEMP TABLE tmp_thai_rule ON COMMIT DROP AS
  WITH mapped AS (
    SELECT DISTINCT ON (m.card_id_th) m.card_id_th, m.card_id_en
      FROM public.card_mappings m
     WHERE m.card_id_en IS NOT NULL
       AND m.confidence_score >= p_min_confidence
       AND (p_card_id IS NULL OR m.card_id_th = p_card_id)
     ORDER BY m.card_id_th, m.confidence_score DESC, m.verified DESC, m.updated_at DESC
  ),
  en_price AS (
    SELECT DISTINCT ON (mv.card_id) mv.card_id, mv.market_avg, mv.currency
      FROM public.market_values mv
     WHERE mv.card_id IN (SELECT card_id_en FROM mapped)
       AND mv.condition IN ('Raw_NM', 'Near Mint')
       AND mv.market_avg > 0
     ORDER BY mv.card_id, (mv.condition = 'Raw_NM') DESC, mv.last_updated DESC
  ),
  base AS (
    SELECT md.card_id_th,
           md.card_id_en,
           ROUND((ep.market_avg
                  * CASE WHEN ep.currency = 'USD' THEN v_thb_per_usd ELSE 1 END
                  * p_ratio)::numeric, 2) AS base_thb
      FROM mapped md
      JOIN en_price ep ON ep.card_id = md.card_id_en
  ),
  sales AS (
    SELECT s.card_id, s.sale_amount_thb, s.sold_at
      FROM public.market_value_sales s
     WHERE s.language = 'th'
       AND s.condition = 'Raw_NM'
       AND s.is_sealed = false
       AND s.sale_amount_thb >= v_floor
       AND s.card_id IN (SELECT card_id_th FROM base)
  ),
  agg AS (
    SELECT b.card_id_th,
           b.card_id_en,
           b.base_thb,
           (SELECT s.sale_amount_thb FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb >= b.base_thb
             ORDER BY s.sold_at DESC LIMIT 1)                                        AS above_sale,
           (SELECT COUNT(*) FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb < b.base_thb)      AS below_count,
           (SELECT AVG(s.sale_amount_thb) FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb < b.base_thb)      AS below_avg,
           (SELECT COUNT(*) FROM sales s WHERE s.card_id = b.card_id_th)             AS sale_count,
           (SELECT MAX(s.sold_at) FROM sales s WHERE s.card_id = b.card_id_th)       AS last_sale_at
      FROM base b
  )
  SELECT a.card_id_th,
         a.card_id_en,
         a.base_thb,
         a.sale_count,
         a.last_sale_at,
         CASE WHEN a.above_sale IS NOT NULL THEN 'th_sale_above'
              WHEN a.below_count >= 3       THEN 'th_sales_avg_below'
              ELSE                               'th_en_ratio' END          AS method,
         CASE WHEN a.above_sale IS NOT NULL THEN a.above_sale
              WHEN a.below_count >= 3       THEN ROUND(a.below_avg::numeric, 2)
              ELSE                               a.base_thb END             AS price_thb
    FROM agg a;

  -- Admin pins are never touched.
  DELETE FROM tmp_thai_rule t
   USING public.market_values mv
   WHERE mv.card_id = t.card_id_th
     AND mv.language = 'th'
     AND mv.condition = 'Raw_NM'
     AND mv.source = 'admin';

  INSERT INTO public.market_values
    (card_id, language, condition, market_avg, currency, source,
     source_links, source_prices, internal_sale_count, internal_last_sale_at,
     game, last_updated, last_priced_at)
  SELECT card_id_th, 'th', 'Raw_NM', price_thb, 'THB',
         CASE WHEN method = 'th_en_ratio' THEN 'api' ELSE 'cardstreet' END,
         jsonb_build_array('English twin ' || card_id_en),
         jsonb_build_object(
           'method',          method,
           'ratio',           p_ratio,
           'base_thb',        base_thb,
           'en_card_id',      card_id_en,
           'min_confidence',  p_min_confidence,
           'sales_considered', sale_count
         ),
         sale_count, last_sale_at, 'pokemon', NOW(), NOW()
    FROM tmp_thai_rule
  ON CONFLICT (card_id, language, condition) DO UPDATE
    SET market_avg            = EXCLUDED.market_avg,
        currency              = 'THB',
        source                = EXCLUDED.source,
        source_links          = EXCLUDED.source_links,
        source_prices         = EXCLUDED.source_prices,
        internal_sale_count   = EXCLUDED.internal_sale_count,
        internal_last_sale_at = EXCLUDED.internal_last_sale_at,
        last_updated          = NOW(),
        last_priced_at        = NOW();
  GET DIAGNOSTICS v_written = ROW_COUNT;

  SELECT COUNT(*) FILTER (WHERE method = 'th_en_ratio'),
         COUNT(*) FILTER (WHERE method = 'th_sale_above'),
         COUNT(*) FILTER (WHERE method = 'th_sales_avg_below')
    INTO v_base, v_above, v_avg
    FROM tmp_thai_rule;

  -- A 10-baht placeholder on a Thai card with no qualifying twin is not a price.
  DELETE FROM public.market_values mv
   WHERE mv.language = 'th'
     AND mv.condition = 'Raw_NM'
     AND mv.source = 'api'
     AND (p_card_id IS NULL OR mv.card_id = p_card_id)
     AND (mv.market_avg <= 10 OR mv.source_prices->>'method' = 'default_floor')
     AND NOT EXISTS (SELECT 1 FROM tmp_thai_rule t WHERE t.card_id_th = mv.card_id);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  PERFORM set_config('cardstreet.internal_write', 'off', true);

  RETURN QUERY SELECT v_written, v_base, v_above, v_avg, v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_thai_price_rule(TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_thai_price_rule(TEXT, NUMERIC, NUMERIC) TO service_role;

-- First full pass. On 2026-09-05 production had 5,210 Thai cards with a >= 0.99
-- twin that carries a price, 105 admin pins, and 3,811 api rows at the 10-baht
-- floor (1,732 of them with no qualifying twin, which this removes).
SELECT * FROM public.apply_thai_price_rule();
