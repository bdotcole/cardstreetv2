-- apply_thai_price_rule was writing Thai (THB, language='th') prices onto JAPANESE
-- cards.
--
-- The `mapped` CTE trusts card_mappings.card_id_th to name a Thai row. After the
-- 2026-09-01 JA/TH set relabel (18 shared set codes split into a base `<CODE>` that
-- kept language='ja' and a new `<CODE>-th` that holds the Thai lineup), 1,603 of
-- those mapping rows point at Japanese cards instead. The function then hard-codes
-- 'th'/'THB' on the INSERT, so each of those Japanese cards ended up with a second
-- market_values row under a different language key.
--
-- market_values is keyed (card_id, language, condition), so both rows survive, and
-- pickDisplayMarketValue ranks ungraded rows freshest-first. This function runs at
-- 03:45 UTC, after the 22:12 UTC Japanese price job, so the Thai row was the fresher
-- one on 1,603 of the 1,606 collisions and won the display. Measured 2026-09-21:
-- SV2a-185 リザードンex showed $218.64 against a real JP market of $21.75, and the
-- SV8a Eeveelution ex line ran 2-3x high across the board.
--
-- Fix: the mapping only qualifies when card_id_th really is a Thai row. Everything
-- else in the function is unchanged. The stranded rows this already wrote are
-- deleted separately (they are not recomputable from here — the function only ever
-- inserts).

CREATE OR REPLACE FUNCTION public.apply_thai_price_rule(p_card_id text DEFAULT NULL::text, p_min_confidence numeric DEFAULT 0.99, p_ratio numeric DEFAULT 0.60)
 RETURNS TABLE(written integer, from_base integer, from_sale_above integer, from_sales_avg_below integer, placeholders_removed integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_thb_per_usd CONSTANT NUMERIC := 1 / 0.028;
  v_floor       NUMERIC := public.market_value_sale_floor_thb();
  v_written     INT := 0;
  v_base        INT := 0;
  v_above       INT := 0;
  v_avg         INT := 0;
  v_removed     INT := 0;
BEGIN
  PERFORM set_config('cardstreet.internal_write', 'on', true);

  DROP TABLE IF EXISTS tmp_thai_rule;
  CREATE TEMP TABLE tmp_thai_rule ON COMMIT DROP AS
  WITH mapped AS (
    SELECT DISTINCT ON (m.card_id_th) m.card_id_th, m.card_id_en
      FROM public.card_mappings m
      -- LANGUAGE GUARD: card_id_th must actually be a Thai row. See header.
      JOIN public.pokemon_cards tc ON tc.id = m.card_id_th AND tc.language = 'th'
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
             ORDER BY s.sold_at DESC LIMIT 1)                                   AS above_sale,
           (SELECT COUNT(*) FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb < b.base_thb) AS below_count,
           (SELECT AVG(s.sale_amount_thb) FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb < b.base_thb) AS below_avg,
           (SELECT COUNT(*) FROM sales s WHERE s.card_id = b.card_id_th)        AS sale_count,
           (SELECT MAX(s.sold_at) FROM sales s WHERE s.card_id = b.card_id_th)  AS last_sale_at
      FROM base b
  )
  SELECT a.card_id_th,
         a.card_id_en,
         a.base_thb,
         a.sale_count,
         a.last_sale_at,
         CASE WHEN a.above_sale IS NOT NULL THEN 'th_sale_above'
              WHEN a.below_count >= 3       THEN 'th_sales_avg_below'
              ELSE                               'th_en_ratio' END      AS method,
         CASE WHEN a.above_sale IS NOT NULL THEN a.above_sale
              WHEN a.below_count >= 3       THEN ROUND(a.below_avg::numeric, 2)
              ELSE                               a.base_thb END         AS price_thb
    FROM agg a;

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
           'method',           method,
           'ratio',            p_ratio,
           'base_thb',         base_thb,
           'en_card_id',       card_id_en,
           'min_confidence',   p_min_confidence,
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
$function$;
