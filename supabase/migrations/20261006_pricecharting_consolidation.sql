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

NOTIFY pgrst, 'reload schema';
