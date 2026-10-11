-- compute_market_movers could not finish (Sentry CARDSTREET-4Q, market_movers
-- empty since it shipped 10-06). For each of ~55k recently changed cards its
-- LATERAL looks up the newest earlier point from the SAME source, but
-- idx_price_snapshots_series has no source column, so every lookup walked the
-- card's whole history (6.3M rows; years of JustTCG daily points) checking source
-- on the heap. A dry run of the SELECT ran past 110 s.
--
-- A partial index over just the rows the function reads (~78k of 6.3M) plus the
-- literal source list in the LATERAL (so the planner can prove the partial
-- predicate) makes each lookup an index-only seek: the 7-day SELECT now takes
-- ~3 s. The function is otherwise unchanged.
--
-- Run the CREATE INDEX on its own (CONCURRENTLY cannot run in a transaction),
-- then the function. Both are safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_snapshots_movers
  ON public.price_snapshots (subject_id, language, source, captured_on)
  INCLUDE (market_thb)
  WHERE condition = 'Market' AND source IN ('pricecharting', 'catalog');

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
           -- Redundant with r.source, but it lets idx_price_snapshots_movers match.
           AND ps.source IN ('pricecharting', 'catalog')
           AND ps.captured_on <= current_date - p_days
         ORDER BY ps.captured_on DESC
         LIMIT 1
      ) b
  ),
  ranked AS (
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
