-- Feature B: API -> Internal Market-Price Switchover.
--
-- Switches CardStreet's own realized sale prices in as the source of truth for a
-- growing set of catalog keys, while keeping the third-party API price as a shadow
-- fallback (api_reference_avg). Everything here is ADDITIVE + DEFAULTED, so applying
-- it on production changes NO behavior until the app-side feature flag
-- (INTERNAL_PRICING_ENABLED) flips and a real sale lands.
--
-- Keying is (card_id, language, condition). Grade is baked into `condition`
-- ('PSA 10', 'BGS 9.5', 'Raw_NM', 'Near Mint', 'Sealed') — there is NO separate grade
-- column. The 3-col UNIQUE constraint market_values_unique_current = UNIQUE
-- (card_id, language, condition) is CONFIRMED present in the live DB (probed
-- 2026-07-06), so every ON CONFLICT (card_id, language, condition) below targets a
-- real constraint. The `currency` column on market_values also exists out-of-band in
-- the live DB (read/written by every writer + the mapper); this migration does NOT add
-- it and writes currency='USD' consistent with existing writers.
--
-- Run in the Supabase SQL Editor (the founder does not use the CLI). Safe on prod.

-- ============================================================================
-- 1. market_values additive columns
-- ============================================================================

ALTER TABLE public.market_values
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api'
    CHECK (source IN ('api', 'cardstreet', 'admin')),
  ADD COLUMN IF NOT EXISTS api_reference_avg NUMERIC,
  ADD COLUMN IF NOT EXISTS internal_sale_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_last_sale_at TIMESTAMPTZ;

-- Backfill the shadow column so existing API rows carry a reference from day one.
UPDATE public.market_values
   SET api_reference_avg = market_avg
 WHERE api_reference_avg IS NULL;

-- Partial index for clobber-guard lookups + the admin surface.
CREATE INDEX IF NOT EXISTS idx_market_values_source_learned
  ON public.market_values (card_id, language, condition)
  WHERE source IN ('cardstreet', 'admin');

-- ============================================================================
-- 2. market_value_sales audit table
-- ============================================================================
-- Append-only audit trail of realized sales that feed internal pricing.
-- order_id UNIQUE => idempotent under webhook retries / the /finalize fallback.

CREATE TABLE IF NOT EXISTS public.market_value_sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  card_id         TEXT NOT NULL,
  language        TEXT NOT NULL,
  condition       TEXT NOT NULL,
  game            TEXT NOT NULL DEFAULT 'pokemon',
  is_sealed       BOOLEAN NOT NULL DEFAULT false,
  sale_amount_thb NUMERIC NOT NULL CHECK (sale_amount_thb > 0),
  sale_amount_usd NUMERIC NOT NULL CHECK (sale_amount_usd > 0),
  sold_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_value_sales_order_unique UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_mvs_key
  ON public.market_value_sales (card_id, language, condition);
CREATE INDEX IF NOT EXISTS idx_mvs_sold_at
  ON public.market_value_sales (sold_at DESC);

-- Service-role-only: the finalize hook + crons write via the service-role client
-- (which bypasses RLS); the admin surface reads the same way. Enabling RLS with no
-- policies blocks the anon/authenticated roles entirely. Mirrors the
-- pricecharting_map precedent.
ALTER TABLE public.market_value_sales ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. recompute_internal_price(card_id, language, condition) -> source
-- ============================================================================
-- Recomputes the internal price for ONE key from its sale history and, if the key
-- qualifies, upserts a source='cardstreet' market_values row. Unified rule:
--   * Once a key has >= threshold paid sales, its price = AVG of the most recent
--     v_window (=10) internal sales for that key. No clamp, no decay.
--   * threshold = 1 for Thai (language='th'), 3 for everything else.
-- source='admin' rows are pinned: this function never touches them.
-- Returns the resulting source ('api' if not yet qualified, else 'cardstreet'/'admin').

CREATE OR REPLACE FUNCTION public.recompute_internal_price(
  p_card_id   TEXT,
  p_language  TEXT,
  p_condition TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  -- Recent-sales window: once a key qualifies, its price is the AVG of the last N sales.
  v_window       CONSTANT INT := 10;
  -- Switch threshold: Thai flips on the FIRST sale; everything else needs 3.
  v_threshold    INT := CASE WHEN p_language = 'th' THEN 1 ELSE 3 END;
  v_count        INT;
  v_last_sale_at TIMESTAMPTZ;
  v_game         TEXT;
  v_existing_src TEXT;
  v_new_avg      NUMERIC;
BEGIN
  -- Admin pin: never overwrite. Report and bail.
  SELECT source INTO v_existing_src
    FROM public.market_values
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
   ORDER BY last_updated DESC
   LIMIT 1;
  IF v_existing_src = 'admin' THEN
    RETURN 'admin';
  END IF;

  SELECT COUNT(*),
         MAX(sold_at),
         MAX(game)
    INTO v_count, v_last_sale_at, v_game
    FROM public.market_value_sales
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
     AND is_sealed = false;

  IF v_count = 0 THEN
    RETURN COALESCE(v_existing_src, 'api');
  END IF;

  -- A key needs >= v_threshold sales to leave the API/formula. The first qualifying
  -- sale only switches the SOURCE; from then on the price is the AVG of the most
  -- recent v_window real sales, like any standard marketplace.
  IF v_count < v_threshold THEN
    RETURN COALESCE(v_existing_src, 'api');
  END IF;

  SELECT AVG(sale_amount_usd)
    INTO v_new_avg
    FROM (
      SELECT sale_amount_usd
        FROM public.market_value_sales
       WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
         AND is_sealed = false
       ORDER BY sold_at DESC
       LIMIT v_window
    ) recent;

  -- Signal the clobber guard that THIS is a trusted internal write, so it passes
  -- through untouched. Transaction-local; reset right after the write. Without it,
  -- the guard would see a DO UPDATE whose retained source is already 'cardstreet'
  -- and cannot distinguish this legit recompute from an API clobber.
  PERFORM set_config('cardstreet.internal_write', 'on', true);

  -- Materialize as source='cardstreet'. ON CONFLICT preserves api_reference_avg
  -- (owned by API writers) and stamps sale metadata. printing left NULL (Pokemon),
  -- so this can only conflict against the 3-col unique constraint.
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
-- 4. recompute_thai_sealed_price(sealed_id) -> boolean
-- ============================================================================
-- Thai sealed: the FIRST paid sale switches off the JP-box-derived estimate; from
-- then on the price is the AVG of the most recent v_window Thai sealed sales (Thai
-- threshold = 1, same unified rule as Thai singles). Writes THB directly into
-- sealed_products (Thai rows are currency='THB'; the display mapper toThb() passes
-- THB through unchanged). p_sealed_id = 'pc-<pricechartingId>' == the sealed listing's
-- card_id == sealed_products.id.

CREATE OR REPLACE FUNCTION public.recompute_thai_sealed_price(
  p_sealed_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_window  CONSTANT INT := 10;
  v_avg_thb NUMERIC;
BEGIN
  -- Thai threshold is 1, so any recorded sale qualifies; average the recent window
  -- (a single sale averages to itself, matching "first sale = the price").
  SELECT AVG(sale_amount_thb) INTO v_avg_thb
    FROM (
      SELECT sale_amount_thb
        FROM public.market_value_sales
       WHERE card_id = p_sealed_id AND language = 'th' AND is_sealed = true
         AND sale_amount_thb > 0
       ORDER BY sold_at DESC
       LIMIT v_window
    ) recent;

  IF v_avg_thb IS NULL OR v_avg_thb <= 0 THEN
    RETURN false;
  END IF;

  -- Pin the Thai sealed row to the realized THB price. currency is already 'THB'
  -- for these rows; set it defensively so the display path stays THB-native.
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
-- 5. Clobber guard trigger (single change, covers every market_values writer)
-- ============================================================================
-- On every INSERT/UPDATE to market_values:
--   * Trusted internal writers (recompute_internal_price + the admin RPCs) set the
--     transaction-local flag `cardstreet.internal_write='on'` right before writing;
--     the guard passes those through untouched.
--   * Everything else is an API writer (the ~20 ingestion paths). On an UPDATE to a
--     key that is ALREADY learned/pinned (OLD.source in cardstreet/admin), preserve
--     the learned market_avg + source and divert the incoming API price into the
--     api_reference_avg shadow. Otherwise just keep the shadow fresh.
--
-- Why key off OLD.source, not NEW.source: API writers upsert via ON CONFLICT DO
-- UPDATE without setting `source`, so on the update path NEW.source is the RETAINED
-- old value. Reading NEW.source would let an API write whose key is already
-- 'cardstreet' short-circuit the guard and clobber the learned price. OLD.source is
-- the reliable signal; the GUC distinguishes the legitimate internal writers.

CREATE OR REPLACE FUNCTION public.guard_market_value_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Trusted internal write (recompute / admin RPC): pass through untouched.
  IF current_setting('cardstreet.internal_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- API write. Protect an existing learned/pinned row; else keep the shadow fresh.
  IF TG_OP = 'UPDATE' AND OLD.source IN ('cardstreet', 'admin') THEN
    NEW.api_reference_avg     := NEW.market_avg;   -- stash the incoming API price
    NEW.market_avg            := OLD.market_avg;   -- keep the learned/pinned price
    NEW.currency              := OLD.currency;     -- ...and its display currency: the
                                                   -- Thai daily cron writes THB, which
                                                   -- would otherwise show a USD value as THB
    NEW.source                := OLD.source;
    NEW.internal_sale_count   := OLD.internal_sale_count;
    NEW.internal_last_sale_at := OLD.internal_last_sale_at;
  ELSE
    NEW.api_reference_avg := NEW.market_avg;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_market_value_source ON public.market_values;
CREATE TRIGGER trg_guard_market_value_source
  BEFORE INSERT OR UPDATE ON public.market_values
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_market_value_source();

-- ============================================================================
-- 5b. Admin write RPCs (guard-aware) -- called by /api/admin/internal-prices
-- ============================================================================
-- The admin route writes via the JS client, where each statement is its own
-- transaction, so a JS-side set_config would never reach the write. These functions
-- set the transaction-local guard flag and write in the SAME transaction, so an admin
-- pin/release is treated as a trusted write (a plain admin UPDATE would otherwise be
-- protected-against as if it were an API clobber, blocking release-to-api).

CREATE OR REPLACE FUNCTION public.admin_pin_internal_price(
  p_card_id TEXT, p_language TEXT, p_condition TEXT, p_usd NUMERIC
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_usd IS NULL OR p_usd <= 0 THEN
    RAISE EXCEPTION 'pin requires a positive usd value';
  END IF;
  PERFORM set_config('cardstreet.internal_write', 'on', true);
  INSERT INTO public.market_values
    (card_id, language, condition, market_avg, currency, source, last_updated)
  VALUES (p_card_id, p_language, p_condition, p_usd, 'USD', 'admin', NOW())
  ON CONFLICT (card_id, language, condition) DO UPDATE
    SET market_avg   = EXCLUDED.market_avg,
        source       = 'admin',
        currency     = 'USD',
        last_updated = NOW();
  PERFORM set_config('cardstreet.internal_write', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_release_internal_price(
  p_card_id TEXT, p_language TEXT, p_condition TEXT, p_to TEXT
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_to NOT IN ('cardstreet', 'api') THEN
    RAISE EXCEPTION 'invalid release target: %', p_to;
  END IF;
  PERFORM set_config('cardstreet.internal_write', 'on', true);
  UPDATE public.market_values
     SET source = p_to, last_updated = NOW()
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition;
  PERFORM set_config('cardstreet.internal_write', 'off', true);
END;
$$;

-- Lock the price-writing / derived functions to the service-role caller. Postgres
-- grants EXECUTE to PUBLIC by default; without this, any authenticated user could set
-- arbitrary prices via PostgREST. Supabase's default privileges grant service_role
-- explicitly, but re-GRANT to be certain the finalize hook + crons keep working.
REVOKE ALL ON FUNCTION public.admin_pin_internal_price(TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_release_internal_price(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_internal_price(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_thai_sealed_price(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pin_internal_price(TEXT, TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_release_internal_price(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_internal_price(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_thai_sealed_price(TEXT) TO service_role;

-- ============================================================================
-- 6. list_internal_price_keys() -- distinct keys for the weekly recompute cron
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_internal_price_keys()
RETURNS TABLE (card_id TEXT, language TEXT, condition TEXT, is_sealed BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT card_id, language, condition, is_sealed
    FROM public.market_value_sales;
$$;
