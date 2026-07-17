-- Two guards against a bad sale locking in a wrong market price.
--
-- GUARD 1 -- sub-floor (admin seed) sales never teach market value.
--   Admins may list below the 20-baht public floor to seed the marketplace (a 1-baht
--   test listing -- components/ListingForm.tsx). Feature B treated those as real market
--   signal, which is worst-case wrong for Thai: language='th' switches to internal
--   pricing on the FIRST sale, and guard_market_value_source() then protects the result
--   from every API writer. One 1-baht seed sale therefore pins a card at ~$0.03 forever,
--   and the app's "Use Recommended" button anchors the next seller to it.
--   Confirmed live: MA3-210 sold at 15 baht (a seed listing) and sits at
--   market_avg = 0.42 USD, source='cardstreet', internal_sale_count = 1.
--   Rule: a sale below the public listing floor is not a market signal, because no
--   ordinary seller can list that low.
--
-- GUARD 2 -- a suspiciously-cheap Thai sale needs corroboration.
--   Even at/above the floor, a Thai key switches on sale #1, so one underpriced sale
--   (often by a seller who anchored to an already-wrong app price) locks the loop.
--   Rule: if the candidate price is < 40% of EITHER the API reference OR the average
--   live active listing for the same card (same graded-ness), require the non-Thai
--   corroboration threshold (3 sales) before switching. A normally-priced first Thai
--   sale still switches on sale #1, unchanged.
--
-- Guard 2 is the design from 20260714_thai_price_sanity_guard.sql (written 2026-07-14
-- on branch claude/card-pricing-graph-readability-48974f, NEVER APPLIED). Both guards
-- CREATE OR REPLACE the same function, so they are MERGED into one body here.
-- ** THIS FILE SUPERSEDES 20260714_thai_price_sanity_guard.sql -- do not run that file;
--    running it after this one would silently drop Guard 1. **
--
-- Filtering on the recorded SALE PRICE (rather than stamping rows at write time) makes
-- Guard 1 hold retroactively and for sales recorded by any version of the app -- there
-- is no deploy-ordering hazard. market_value_sales stays a complete audit trail:
-- sub-floor sales are still recorded, they just never count toward a price.
--
-- Idempotent. Run in the Supabase SQL Editor (the founder does not use the CLI).
-- Safe on prod: sub-floor sales stop counting, suspiciously-cheap Thai sales need
-- corroboration, and keys whose price came ONLY from sub-floor sales are handed back
-- to the API writers.

-- ============================================================================
-- 1. The floor, as the single SQL-side source of truth
-- ============================================================================
-- Mirrors PUBLIC_MIN_LISTING_PRICE_THB in lib/pricingFloors.ts (SQL cannot import TS).
-- IMMUTABLE so the planner can inline it.

CREATE OR REPLACE FUNCTION public.market_value_sale_floor_thb()
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 20::NUMERIC;
$$;

COMMENT ON FUNCTION public.market_value_sale_floor_thb() IS
  'Minimum realized sale price (THB) that may teach market value. Sales below this can '
  'only come from the admin sub-floor seed exception, so they are excluded from every '
  'internal recompute. Mirrors PUBLIC_MIN_LISTING_PRICE_THB in lib/pricingFloors.ts.';

-- Keeps the filtered history scans index-only on hot keys.
CREATE INDEX IF NOT EXISTS idx_mvs_key_qualifying
  ON public.market_value_sales (card_id, language, condition, sold_at DESC)
  WHERE sale_amount_thb >= 20;

-- ============================================================================
-- 2. recompute_internal_price -- both guards
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_internal_price(
  p_card_id   TEXT,
  p_language  TEXT,
  p_condition TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  -- Recent-sales window: once a key qualifies, its price is the AVG of the last N sales.
  v_window          CONSTANT INT := 10;
  -- Guard 1: sub-floor sales are admin seed listings, not market signal.
  v_floor           CONSTANT NUMERIC := public.market_value_sale_floor_thb();
  -- Guard 2: ~THB per USD, mirrors EXCHANGE_RATES.USD = 0.028 (lib/internalPricing.ts).
  -- Only used to bring the API reference into THB for the sanity comparison; a rough
  -- rate is fine for a 40% floor.
  v_thb_per_usd     CONSTANT NUMERIC := 35.71;
  -- Guard 2: a candidate below this fraction of the reference is "suspiciously cheap".
  v_susp_frac       CONSTANT NUMERIC := 0.40;
  -- Guard 2: corroboration required to switch a suspiciously-cheap Thai key
  -- (= the non-Thai default).
  v_susp_threshold  CONSTANT INT := 3;

  -- Switch threshold: Thai flips on the FIRST sale; everything else needs 3.
  v_threshold       INT := CASE WHEN p_language = 'th' THEN 1 ELSE 3 END;
  v_count           INT;
  v_last_sale_at    TIMESTAMPTZ;
  v_game            TEXT;
  v_existing_src    TEXT;
  v_api_ref         NUMERIC;
  v_currency        TEXT;
  v_new_avg         NUMERIC;    -- USD: the value materialized into market_values
  v_cand_thb        NUMERIC;    -- THB: same candidate, for the sanity comparison
  v_is_graded_key   BOOLEAN := p_condition ~ '^(PSA|BGS|CGC|ARS) ';
  v_api_ref_thb     NUMERIC;
  v_listing_avg_thb NUMERIC;
BEGIN
  -- Admin pin: never overwrite. Report and bail.
  SELECT source, api_reference_avg, currency
    INTO v_existing_src, v_api_ref, v_currency
    FROM public.market_values
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
   ORDER BY last_updated DESC
   LIMIT 1;
  IF v_existing_src = 'admin' THEN
    RETURN 'admin';
  END IF;

  -- Guard 1 applies from here on: sub-floor sales are invisible to every read below.
  SELECT COUNT(*), MAX(sold_at), MAX(game)
    INTO v_count, v_last_sale_at, v_game
    FROM public.market_value_sales
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
     AND is_sealed = false
     AND sale_amount_thb >= v_floor;

  IF v_count = 0 THEN
    -- No qualifying sales. If this key is only 'cardstreet' because of sales that no
    -- longer qualify (an admin seed sale), hand it back to the API writers.
    --
    -- market_avg and currency are deliberately LEFT ALONE rather than restored from
    -- api_reference_avg: the shadow has no reliable currency provenance (the Thai daily
    -- cron writes THB, PriceCharting/JustTCG write USD, and the guard copies whatever
    -- came in), so restoring it blind would reintroduce the ~35x currency bug fixed in
    -- 6ca369e. Flipping source to 'api' is enough -- the guard stops protecting the row,
    -- so the next refresh cron overwrites it with a correctly-denominated price.
    IF v_existing_src = 'cardstreet' THEN
      PERFORM set_config('cardstreet.internal_write', 'on', true);
      UPDATE public.market_values
         SET source                = 'api',
             internal_sale_count   = 0,
             internal_last_sale_at = NULL,
             last_updated          = NOW()
       WHERE card_id = p_card_id AND language = p_language AND condition = p_condition;
      PERFORM set_config('cardstreet.internal_write', 'off', true);
      RETURN 'api';
    END IF;
    RETURN COALESCE(v_existing_src, 'api');
  END IF;

  -- Candidate = AVG of the most recent v_window qualifying sales (USD for the store,
  -- THB for the sanity check). Computed before the threshold gate so Guard 2 can
  -- inspect it.
  SELECT AVG(sale_amount_usd), AVG(sale_amount_thb)
    INTO v_new_avg, v_cand_thb
    FROM (
      SELECT sale_amount_usd, sale_amount_thb
        FROM public.market_value_sales
       WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
         AND is_sealed = false
         AND sale_amount_thb >= v_floor
       ORDER BY sold_at DESC
       LIMIT v_window
    ) recent;

  -- Guard 2 -- Thai sanity check: only relevant while below the corroboration
  -- threshold. A suspiciously-cheap candidate must clear v_susp_threshold sales
  -- before switching.
  IF p_language = 'th' AND v_count < v_susp_threshold THEN
    v_api_ref_thb := CASE
      WHEN v_api_ref IS NULL       THEN NULL
      WHEN v_currency = 'THB'      THEN v_api_ref
      ELSE v_api_ref * v_thb_per_usd            -- USD (or unknown) reference -> THB
    END;

    -- Sub-floor ACTIVE listings are admin seed listings too, and must not drag this
    -- reference down -- otherwise a 1-baht seed listing on the same card would make a
    -- genuinely-cheap sale look reasonable and defeat Guard 2. Same floor, same reason.
    SELECT AVG(price) INTO v_listing_avg_thb
      FROM public.listings
     WHERE card_id = p_card_id
       AND status = 'active'
       AND price >= v_floor
       AND COALESCE(is_graded, false) = v_is_graded_key;  -- compare like-with-like

    IF (v_api_ref_thb IS NOT NULL AND v_api_ref_thb > 0
          AND v_cand_thb < v_susp_frac * v_api_ref_thb)
       OR (v_listing_avg_thb IS NOT NULL AND v_listing_avg_thb > 0
          AND v_cand_thb < v_susp_frac * v_listing_avg_thb)
    THEN
      v_threshold := v_susp_threshold;
    END IF;
  END IF;

  -- A key needs >= v_threshold qualifying sales to leave the API/formula. The first
  -- qualifying sale only switches the SOURCE; from then on the price is the AVG of the
  -- most recent v_window real sales, like any standard marketplace.
  IF v_count < v_threshold THEN
    RETURN COALESCE(v_existing_src, 'api');
  END IF;

  -- Signal the clobber guard that THIS is a trusted internal write, so it passes
  -- through untouched. Transaction-local; reset right after the write.
  PERFORM set_config('cardstreet.internal_write', 'on', true);

  INSERT INTO public.market_values
    (card_id, language, condition, market_avg, currency, source,
     internal_sale_count, internal_last_sale_at, game, last_updated)
  VALUES
    (p_card_id, p_language, p_condition, v_new_avg, 'USD', 'cardstreet',
     v_count, v_last_sale_at, COALESCE(v_game, 'pokemon'), NOW())
  ON CONFLICT (card_id, language, condition) DO UPDATE
    SET market_avg            = EXCLUDED.market_avg,
        source                = 'cardstreet',
        internal_sale_count   = EXCLUDED.internal_sale_count,
        internal_last_sale_at = EXCLUDED.internal_last_sale_at,
        currency              = 'USD',
        last_updated          = NOW()
        -- api_reference_avg intentionally NOT touched: shadow owned by API writers.
  ;

  PERFORM set_config('cardstreet.internal_write', 'off', true);
  RETURN 'cardstreet';
END;
$$;

-- ============================================================================
-- 3. recompute_thai_sealed_price -- Guard 1
-- ============================================================================
-- sealed_products has no `source` column, so there is nothing to release: with no
-- qualifying sale this returns false and leaves the row for the PriceCharting cron,
-- which also ignores sub-floor sales and so re-derives its estimate.
-- Guard 2 does not apply: sealed has no api_reference_avg / per-card listing shape.

CREATE OR REPLACE FUNCTION public.recompute_thai_sealed_price(
  p_sealed_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_window  CONSTANT INT := 10;
  v_floor   CONSTANT NUMERIC := public.market_value_sale_floor_thb();
  v_avg_thb NUMERIC;
BEGIN
  SELECT AVG(sale_amount_thb) INTO v_avg_thb
    FROM (
      SELECT sale_amount_thb
        FROM public.market_value_sales
       WHERE card_id = p_sealed_id AND language = 'th' AND is_sealed = true
         AND sale_amount_thb >= v_floor
       ORDER BY sold_at DESC
       LIMIT v_window
    ) recent;

  IF v_avg_thb IS NULL OR v_avg_thb <= 0 THEN
    RETURN false;
  END IF;

  UPDATE public.sealed_products
     SET new_price    = v_avg_thb,
         currency     = 'THB',
         last_updated = NOW()
   WHERE id = p_sealed_id
     AND language = 'th';

  RETURN true;
END;
$$;

-- ============================================================================
-- 4. Heal keys already priced off a sub-floor sale
-- ============================================================================
-- Recompute every key that has at least one sub-floor sale on record. Keys with no
-- qualifying sales left are released to 'api' by the branch above; keys that also have
-- real sales simply re-average without the seed sale. Idempotent and safe to re-run.
--
-- Note this heals Guard 1 damage only. It does NOT revert a key that switched on a
-- suspiciously-cheap but at-or-above-floor sale before Guard 2 existed -- Guard 2 gates
-- the initial switch. Fix those with admin_pin_internal_price / admin_release_internal_price.

DO $$
DECLARE
  r      RECORD;
  v_from TEXT;
  v_to   TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT s.card_id, s.language, s.condition, s.is_sealed
      FROM public.market_value_sales s
     WHERE s.sale_amount_thb < public.market_value_sale_floor_thb()
  LOOP
    IF r.is_sealed THEN
      PERFORM public.recompute_thai_sealed_price(r.card_id);
      RAISE NOTICE 'sealed % -- recomputed without sub-floor sales', r.card_id;
    ELSE
      SELECT source INTO v_from FROM public.market_values
       WHERE card_id = r.card_id AND language = r.language AND condition = r.condition;
      v_to := public.recompute_internal_price(r.card_id, r.language, r.condition);
      RAISE NOTICE '% / % / % -- source % -> %',
        r.card_id, r.language, r.condition, COALESCE(v_from, '(none)'), v_to;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 5. Verification
-- ============================================================================
-- Expect zero rows: no market_values row may still be sourced from CardStreet sales
-- while having no qualifying sale behind it.

SELECT mv.card_id, mv.language, mv.condition, mv.market_avg, mv.source
  FROM public.market_values mv
 WHERE mv.source = 'cardstreet'
   AND NOT EXISTS (
     SELECT 1 FROM public.market_value_sales s
      WHERE s.card_id = mv.card_id
        AND s.language = mv.language
        AND s.condition = mv.condition
        AND s.is_sealed = false
        AND s.sale_amount_thb >= public.market_value_sale_floor_thb()
   );
