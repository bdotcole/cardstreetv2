-- PriceCharting becomes the only market-data vendor (founder decision 2026-10-05).
--
-- JustTCG is cancelled at its next billing date (~2026-10-12). Its price history
-- already in price_snapshots stays. From then on, ungraded (Raw_NM) prices come
-- from PriceCharting's loose-price, read from the same bulk CSVs the daily
-- /api/cron/pricecharting already downloads for graded prices.
--
-- Matching our cards to PriceCharting used to go by set name, and PriceCharting
-- names sets differently ("Pokemon Scarlet & Violet 151" vs our "151"; every
-- English black-star promo in one "Pokemon Promo" console). JustTCG's card
-- records carry the TCGplayer product id, and so does PriceCharting's CSV
-- (`tcg-id`), so the id links the two without name guessing.
-- scripts/ingest/pricecharting-bridge.mjs loads it.
--
--   1. pokemon_cards.tcgplayer_id: the TCGplayer product id. Harvested from
--      JustTCG on 2026-10-05 for ~79k cards. Kept after JustTCG is gone, so
--      future PriceCharting matching never depends on it again.
--   2. set_card_tcgplayer_ids(jsonb): bulk writer for (1). A PostgREST upsert
--      cannot do a partial-column update on pokemon_cards (the insert path trips
--      its NOT NULL columns), so the script calls this instead. Service role only.
--   3. pricecharting_map.match_method: how a row was matched ('name_number' for
--      the original set-name ingest, 'tcgplayer_id' for the bridge), for audits.
--   4. latest_price_snapshots(text[]): newest stored point per subject, so the
--      price-snapshots cron writes a Thai card's point only when its price moved
--      (change points; /api/price-history forward-fills the days between).
--      Service role only.
--   5. Market movers: market_movers + compute_market_movers(), the cards whose
--      price moved most over 1 and 7 days, filled daily by
--      /api/cron/market-movers from price_snapshots and read by
--      /api/market/movers (the "Market movers" strip). Public read.
--   6. pricecharting_console_coverage: per PriceCharting set ("console"), how many
--      singles it lists and how many we have matched. Filled by the pricecharting
--      cron; the admin Catalog page and the daily DB check list the sets we're
--      missing. Service role only.
--
-- Nothing here deletes price data. Old prices stay in price_snapshots as history.
--
-- Idempotent. Run in the Supabase SQL Editor.

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.pokemon_cards
  ADD COLUMN IF NOT EXISTS tcgplayer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pokemon_cards_tcgplayer_id
  ON public.pokemon_cards (tcgplayer_id)
  WHERE tcgplayer_id IS NOT NULL;

-- 2 ---------------------------------------------------------------------------
-- p_rows: [{"id": "<card id>", "tcgplayer_id": "<id>"}, ...]
-- Only fills or corrects the one column; never touches other card data.
CREATE OR REPLACE FUNCTION public.set_card_tcgplayer_ids(p_rows JSONB)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH upd AS (
    UPDATE public.pokemon_cards pc
       SET tcgplayer_id = r.tcgplayer_id
      FROM jsonb_to_recordset(p_rows) AS r(id TEXT, tcgplayer_id TEXT)
     WHERE pc.id = r.id
       AND r.tcgplayer_id IS NOT NULL
       AND pc.tcgplayer_id IS DISTINCT FROM r.tcgplayer_id
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;

REVOKE ALL ON FUNCTION public.set_card_tcgplayer_ids(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_card_tcgplayer_ids(JSONB) TO service_role;

-- 3 ---------------------------------------------------------------------------
ALTER TABLE public.pricecharting_map
  ADD COLUMN IF NOT EXISTS match_method TEXT;

UPDATE public.pricecharting_map
   SET match_method = 'name_number'
 WHERE match_method IS NULL;

-- 4 ---------------------------------------------------------------------------
-- Uses idx_price_snapshots_series (subject_id, language, condition, captured_on).
CREATE OR REPLACE FUNCTION public.latest_price_snapshots(p_ids TEXT[], p_condition TEXT DEFAULT 'Market')
RETURNS TABLE (subject_id TEXT, language TEXT, market_thb NUMERIC, captured_on DATE)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (ps.subject_id, ps.language)
         ps.subject_id, ps.language, ps.market_thb, ps.captured_on
    FROM public.price_snapshots ps
   WHERE ps.subject_id = ANY (p_ids)
     AND ps.condition = p_condition
   ORDER BY ps.subject_id, ps.language, ps.captured_on DESC;
$$;

REVOKE ALL ON FUNCTION public.latest_price_snapshots(TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.latest_price_snapshots(TEXT[], TEXT) TO service_role;

-- 5 ---------------------------------------------------------------------------
-- The movers computation scans the recent days of price_snapshots; without this
-- it reads the whole table (~3M rows) every day.
CREATE INDEX IF NOT EXISTS idx_price_snapshots_captured_on
  ON public.price_snapshots (captured_on);

CREATE TABLE IF NOT EXISTS public.market_movers (
  window_days  INTEGER     NOT NULL,
  subject_id   TEXT        NOT NULL,
  language     TEXT        NOT NULL,
  game         TEXT,
  source       TEXT        NOT NULL,
  old_thb      NUMERIC     NOT NULL,
  new_thb      NUMERIC     NOT NULL,
  change_pct   NUMERIC     NOT NULL,
  old_on       DATE,
  new_on       DATE,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (window_days, subject_id, language)
);
CREATE INDEX IF NOT EXISTS idx_market_movers_rank
  ON public.market_movers (window_days, game, change_pct);

ALTER TABLE public.market_movers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_movers_public_read ON public.market_movers;
CREATE POLICY market_movers_public_read ON public.market_movers
  FOR SELECT TO anon, authenticated USING (true);

-- Rebuilds one window. A mover compares a card's newest point in the window with
-- its last point before the window, FROM THE SAME SOURCE: a card that moved from
-- JustTCG to PriceCharting shows a vendor change, not a market move, so a series
-- only counts against itself. Noise filters, tuned on live data 2026-10-06 (without
-- them the top of the list was variant swaps like ฿3 -> ฿486, not market moves):
--   p_min_thb     BOTH prices must reach this (no ฿3 -> ฿6 "+100%");
--   p_max_rise / p_max_drop  bigger moves than this are data errors far more often
--                 than real moves, so they are left out;
--   p_min_volume  PriceCharting cards need at least this many recorded sales
--                 (market_values.source_prices.sales_volume), when it is known.
CREATE OR REPLACE FUNCTION public.compute_market_movers(
  p_days       INTEGER DEFAULT 7,
  p_min_thb    NUMERIC DEFAULT 50,
  p_min_volume INTEGER DEFAULT 3,
  p_max_rise   NUMERIC DEFAULT 400,
  p_max_drop   NUMERIC DEFAULT 80
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n INTEGER;
BEGIN
  DELETE FROM public.market_movers WHERE window_days = p_days;

  WITH recent AS (
    SELECT DISTINCT ON (ps.subject_id, ps.language, ps.source)
           ps.subject_id, ps.language, ps.source,
           ps.market_thb AS new_thb, ps.captured_on AS new_on
      FROM public.price_snapshots ps
     WHERE ps.captured_on > current_date - p_days
       AND ps.condition = 'Market'
       AND ps.is_sealed = false
       AND ps.source IN ('pricecharting', 'catalog')
     ORDER BY ps.subject_id, ps.language, ps.source, ps.captured_on DESC
  ),
  paired AS (
    SELECT r.*, b.market_thb AS old_thb, b.captured_on AS old_on
      FROM recent r
      CROSS JOIN LATERAL (
        SELECT ps.market_thb, ps.captured_on
          FROM public.price_snapshots ps
         WHERE ps.subject_id = r.subject_id
           AND ps.language = r.language
           AND ps.condition = 'Market'
           AND ps.source = r.source
           AND ps.captured_on <= current_date - p_days
         ORDER BY ps.captured_on DESC
         LIMIT 1
      ) b
  ),
  ranked AS (
    -- A listed card has both a 'catalog' and a 'pricecharting' series; keep one.
    SELECT DISTINCT ON (p.subject_id, p.language) p.*
      FROM paired p
     ORDER BY p.subject_id, p.language, (p.source = 'pricecharting') DESC
  )
  INSERT INTO public.market_movers
    (window_days, subject_id, language, game, source, old_thb, new_thb, change_pct, old_on, new_on, computed_at)
  SELECT p_days, r.subject_id, r.language, pc.game, r.source, r.old_thb, r.new_thb,
         ROUND((r.new_thb - r.old_thb) / r.old_thb * 100, 1), r.old_on, r.new_on, now()
    FROM ranked r
    JOIN public.pokemon_cards pc ON pc.id = r.subject_id
    LEFT JOIN public.market_values mv
      ON mv.card_id = r.subject_id
     AND mv.condition = 'Raw_NM'
     AND mv.language = CASE r.language WHEN 'ja' THEN 'jp' ELSE r.language END
   WHERE r.old_thb > 0
     AND r.new_thb <> r.old_thb
     AND LEAST(r.old_thb, r.new_thb) >= p_min_thb
     AND (r.new_thb - r.old_thb) / r.old_thb * 100 BETWEEN -p_max_drop AND p_max_rise
     AND (r.source <> 'pricecharting'
          OR (mv.source_prices->>'sales_volume') IS NULL
          OR (mv.source_prices->>'sales_volume')::NUMERIC >= p_min_volume);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_market_movers(INTEGER, NUMERIC, INTEGER, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_market_movers(INTEGER, NUMERIC, INTEGER, NUMERIC, NUMERIC) TO service_role;

-- 6 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricecharting_console_coverage (
  console_name     TEXT        PRIMARY KEY,
  game             TEXT        NOT NULL,
  language         TEXT        NOT NULL,   -- en | ja | zh | ko
  card_products    INTEGER     NOT NULL DEFAULT 0,
  mapped_products  INTEGER     NOT NULL DEFAULT 0,
  release_date     DATE,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pc_console_coverage_game
  ON public.pricecharting_console_coverage (game, updated_at);

ALTER TABLE public.pricecharting_console_coverage ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
