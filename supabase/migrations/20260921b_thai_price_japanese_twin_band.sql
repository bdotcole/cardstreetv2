-- Japanese-twin sanity band for apply_thai_price_rule.
--
-- Supersedes 20260921_thai_price_rule_language_guard.sql (same function, language
-- guard retained). If that one was never run, running this alone is sufficient.
--
-- WHY
-- ---
-- The rule anchors every Thai price at p_ratio (0.60) x the English twin named by
-- card_mappings. When that mapping is wrong the price is wrong, and nothing
-- downstream notices: `th-SV4a-075` (a Shiny Treasure ex RR) is mapped to `svp-050`,
-- an unrelated promo, and `SV8a-th/097 Zoroark` to `bw4-102`, a 2012 Black & White
-- card whose English price is 80x the real one.
--
-- A Thai set is a 1:1 reprint of a Japanese set with identical numbering, so the
-- Japanese twin — same set code minus the `-th` suffix, same collector number — is
-- an independent second opinion on what the card is worth. Measured 2026-09-21
-- across the 1,761 Thai cards that have both anchors: 95 have an English anchor
-- more than 5x the Japanese twin (55 of them more than 10x).
--
-- ONE-DIRECTIONAL, DELIBERATELY
-- -----------------------------
-- The band fires only when the ENGLISH anchor is implausibly HIGH. The opposite
-- direction (336 cards where English is under a fifth of the twin) is NOT acted on,
-- because there the Japanese number is usually the bad one — `SV2a-th/094 Gengar`
-- reads EN 67 THB against a Japanese twin at 14,374 THB, and 14,374 is the
-- implausible figure for a mid-set common. Acting on that side would import a new
-- class of error. It is recorded as `ja_ratio` in source_prices instead, so the
-- low side can be judged from data later.
--
-- The fallback price is the Japanese twin run through the SAME p_ratio, which keeps
-- the founder's 60% rule intact — only the anchor changes, never the multiplier.
-- Realized Thai sales still override it afterwards, exactly as before.
--
-- Guards on the twin: language='ja', a Raw_NM price above zero, and priced within
-- HOT/30 days, so a stale or missing Japanese row can never displace a live English
-- one. Set p_ja_band = 0 to disable the band entirely.

-- The old 3-arg signature must go, not just be replaced: this version adds a
-- parameter AND a return column. CREATE OR REPLACE cannot change a return type,
-- and a new argument list would register a second overload — both all-defaulted,
-- so a bare apply_thai_price_rule() would then fail as ambiguous.
DROP FUNCTION IF EXISTS public.apply_thai_price_rule(text, numeric, numeric);
DROP FUNCTION IF EXISTS public.apply_thai_price_rule(text, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.apply_thai_price_rule(p_card_id text DEFAULT NULL::text, p_min_confidence numeric DEFAULT 0.99, p_ratio numeric DEFAULT 0.60, p_ja_band numeric DEFAULT 5)
 RETURNS TABLE(written integer, from_base integer, from_sale_above integer, from_sales_avg_below integer, placeholders_removed integer, from_ja_band integer)
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
  v_jaband      INT := 0;
BEGIN
  PERFORM set_config('cardstreet.internal_write', 'on', true);

  DROP TABLE IF EXISTS tmp_thai_rule;
  CREATE TEMP TABLE tmp_thai_rule ON COMMIT DROP AS
  WITH mapped AS (
    SELECT DISTINCT ON (m.card_id_th) m.card_id_th, m.card_id_en
      FROM public.card_mappings m
      -- LANGUAGE GUARD: card_id_th must actually be a Thai row. After the
      -- 2026-09-01 JA/TH set relabel, 1,603 mappings point at Japanese cards, and
      -- the INSERT below hard-codes 'th'/'THB' — so without this the rule writes
      -- Thai prices onto Japanese cards.
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
  -- The Japanese twin of every Thai card: same set code without the `-th` suffix,
  -- same collector number (the Thai number may carry a "/total" tail; the Japanese
  -- one may too, so both are reduced to the bare number and zero-padded).
  ja_price AS (
    SELECT DISTINCT ON (j.set_id, LPAD(SPLIT_PART(j.number, '/', 1), 4, '0'))
           j.set_id                                        AS ja_set,
           LPAD(SPLIT_PART(j.number, '/', 1), 4, '0')      AS ja_num,
           j.id                                            AS ja_card_id,
           mv.market_avg
             * CASE WHEN mv.currency = 'USD' THEN v_thb_per_usd ELSE 1 END
             * p_ratio                                     AS ja_thb
      FROM public.pokemon_cards j
      JOIN public.market_values mv
        ON mv.card_id = j.id
       AND mv.language = 'jp'
       AND mv.condition = 'Raw_NM'
       AND mv.market_avg > 0
       AND mv.last_updated > NOW() - INTERVAL '30 days'
     WHERE j.language = 'ja'
     ORDER BY j.set_id, ja_num, mv.last_updated DESC
  ),
  base AS (
    SELECT md.card_id_th,
           md.card_id_en,
           ROUND((ep.market_avg
                  * CASE WHEN ep.currency = 'USD' THEN v_thb_per_usd ELSE 1 END
                  * p_ratio)::numeric, 2) AS en_thb,
           ROUND(jp.ja_thb::numeric, 2)   AS ja_thb,
           jp.ja_card_id
      FROM mapped md
      JOIN en_price ep ON ep.card_id = md.card_id_en
      JOIN public.pokemon_cards tc ON tc.id = md.card_id_th
      LEFT JOIN ja_price jp
        ON jp.ja_set = REGEXP_REPLACE(tc.set_id, '-th$', '')
       AND jp.ja_num = LPAD(SPLIT_PART(tc.number, '/', 1), 4, '0')
  ),
  -- THE BAND. Out of band on the HIGH side only -> the Japanese twin becomes the
  -- anchor. Everything else keeps the English anchor untouched.
  banded AS (
    SELECT b.card_id_th,
           b.card_id_en,
           b.en_thb,
           b.ja_thb,
           b.ja_card_id,
           (p_ja_band > 0 AND b.ja_thb IS NOT NULL AND b.ja_thb > 0
              AND b.en_thb > b.ja_thb * p_ja_band)       AS ja_band_hit,
           CASE WHEN p_ja_band > 0 AND b.ja_thb IS NOT NULL AND b.ja_thb > 0
                     AND b.en_thb > b.ja_thb * p_ja_band
                THEN b.ja_thb ELSE b.en_thb END          AS base_thb
      FROM base b
  ),
  sales AS (
    SELECT s.card_id, s.sale_amount_thb, s.sold_at
      FROM public.market_value_sales s
     WHERE s.language = 'th'
       AND s.condition = 'Raw_NM'
       AND s.is_sealed = false
       AND s.sale_amount_thb >= v_floor
       AND s.card_id IN (SELECT card_id_th FROM banded)
  ),
  agg AS (
    SELECT b.card_id_th,
           b.card_id_en,
           b.base_thb,
           b.en_thb,
           b.ja_thb,
           b.ja_card_id,
           b.ja_band_hit,
           (SELECT s.sale_amount_thb FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb >= b.base_thb
             ORDER BY s.sold_at DESC LIMIT 1)                                   AS above_sale,
           (SELECT COUNT(*) FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb < b.base_thb) AS below_count,
           (SELECT AVG(s.sale_amount_thb) FROM sales s
             WHERE s.card_id = b.card_id_th AND s.sale_amount_thb < b.base_thb) AS below_avg,
           (SELECT COUNT(*) FROM sales s WHERE s.card_id = b.card_id_th)        AS sale_count,
           (SELECT MAX(s.sold_at) FROM sales s WHERE s.card_id = b.card_id_th)  AS last_sale_at
      FROM banded b
  )
  SELECT a.card_id_th,
         a.card_id_en,
         a.base_thb,
         a.en_thb,
         a.ja_thb,
         a.ja_card_id,
         a.ja_band_hit,
         a.sale_count,
         a.last_sale_at,
         CASE WHEN a.above_sale IS NOT NULL THEN 'th_sale_above'
              WHEN a.below_count >= 3       THEN 'th_sales_avg_below'
              WHEN a.ja_band_hit            THEN 'th_ja_band'
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
         CASE WHEN method IN ('th_en_ratio', 'th_ja_band') THEN 'api' ELSE 'cardstreet' END,
         CASE WHEN method = 'th_ja_band'
              THEN jsonb_build_array('Japanese twin ' || ja_card_id,
                                     'English twin ' || card_id_en || ' rejected by band')
              ELSE jsonb_build_array('English twin ' || card_id_en) END,
         jsonb_build_object(
           'method',           method,
           'ratio',            p_ratio,
           'base_thb',         base_thb,
           'en_card_id',       card_id_en,
           'en_thb',           en_thb,
           'ja_card_id',       ja_card_id,
           'ja_thb',           ja_thb,
           -- >1 means the English anchor sits above the Japanese twin. Logged even
           -- when the band does not fire, so the untouched low side stays visible.
           'ja_ratio',         CASE WHEN ja_thb > 0 THEN ROUND((en_thb / ja_thb)::numeric, 3) END,
           'ja_band',          p_ja_band,
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
         COUNT(*) FILTER (WHERE method = 'th_sales_avg_below'),
         COUNT(*) FILTER (WHERE method = 'th_ja_band')
    INTO v_base, v_above, v_avg, v_jaband
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

  RETURN QUERY SELECT v_written, v_base, v_above, v_avg, v_removed, v_jaband;
END;
$function$;
