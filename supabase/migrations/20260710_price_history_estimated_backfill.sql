-- One-time ESTIMATED price-history backfill for the "Price Over Time" chart.
--
-- price_snapshots only grows forward from 2026-07-09 (the day the daily cron first
-- ran), so the chart's new 7d/30d/90d/180d/1y range filters would render a flat
-- 2-day line for months. Neither pricing API can supply the missing past:
-- PriceCharting is current-value only, and JustTCG's history endpoint is too
-- sparse/stale per card to trust (probed 2026-07-10). Per founder decision, the
-- past is therefore seeded with ROUGH ESTIMATES so the ranges have something to
-- show, while real data accrues forward from the cron (and ages the estimates out).
--
-- How the estimates are built, per existing series (subject_id, language, condition):
--   * Anchored to the series' EARLIEST real snapshot, so the estimated curve meets
--     the real data exactly - no visible seam.
--   * A deterministic random walk backward from that anchor: hashtext() noise keyed
--     on (subject, day), ~0.9%/day jitter + a slight upward long-term drift (a year
--     ago typically prices ~10-20% below today, matching the market's general climb),
--     plus a slow ~140-day sine swell (amplitude ~3.5%) so mid-range views show
--     believable structure instead of pure static. Fully deterministic: re-running
--     produces byte-identical values (and ON CONFLICT DO NOTHING skips them anyway).
--
-- Honesty guarantees:
--   * Every generated row is flagged source='estimated' - real rows are
--     'catalog' / 'pricecharting'. One DELETE removes all estimates if we ever
--     want them gone: DELETE FROM price_snapshots WHERE source = 'estimated';
--   * ON CONFLICT DO NOTHING - a real snapshot is NEVER overwritten, and re-runs
--     are no-ops.
--   * Only series that already exist get a backfill. Subjects first charted later
--     grow real history forward only, as intended.
--
-- Scale: ~3.8k series x 365 days = ~1.4M rows, ~150-200MB incl. index.
-- The insert is split into 4 hash buckets so each statement stays well inside the
-- SQL Editor's statement timeout. Run the whole file at once; if the editor still
-- times out, run each statement one at a time, TOP TO BOTTOM - the policy block
-- first, then the four INSERTs. Every statement is independently idempotent.

-- ============ Tighten public reads to the free window (run FIRST) ============
-- 7d/30d/90d chart ranges are free; 180d/1y are Pro (advanced_market). The old
-- USING (true) policy from 20260708 let anyone with the public anon key read the
-- full year via PostgREST directly, making the API's requirePremium() gate
-- decorative. Public SELECT now covers only the free window (+1 day of timezone
-- slack); the API serves Pro ranges with the service role after requirePremium()
-- passes. The daily cron also writes with the service role, so it is unaffected.
-- This block runs BEFORE the inserts on purpose: if a timeout interrupts the run,
-- the paywall must already be enforced by the time any year-deep rows exist. (The
-- inserts below run as the table owner, which RLS does not constrain.)
DROP POLICY IF EXISTS "Price snapshots are viewable by everyone" ON public.price_snapshots;
DROP POLICY IF EXISTS "Price snapshots are viewable within the free window" ON public.price_snapshots;
CREATE POLICY "Price snapshots are viewable within the free window"
  ON public.price_snapshots FOR SELECT
  USING (captured_on >= (NOW() AT TIME ZONE 'utc')::date - 91);

-- ============ Statement 1 of 4 (bucket 0) ============
INSERT INTO public.price_snapshots
  (subject_id, language, condition, is_sealed, market_thb, market_native, currency, source, captured_on, captured_at)
SELECT
  w.subject_id, w.language, w.condition, w.is_sealed,
  GREATEST(1, ROUND(
    w.anchor_thb
    * EXP(-w.cum_return)
    * (1 + 0.035 * (SIN(2 * PI() * (w.day_num / 140.0) + w.phase)
                  - SIN(2 * PI() * (w.anchor_day_num / 140.0) + w.phase)))
  )),
  NULL, 'THB', 'estimated',
  w.day, w.day::timestamptz
FROM (
  SELECT
    d.*,
    -- Backward cumulative daily log-return from the day before the anchor down to d:
    -- drift 0.04%/day + uniform +-0.9%/day noise, seeded on (subject, condition, day).
    SUM(0.0004 + 0.009 * ((hashtext(d.subject_id || '|' || d.condition || '|' || d.day::text)::bigint % 1000001) / 1000000.0))
      OVER (PARTITION BY d.subject_id, d.language, d.condition ORDER BY d.day DESC ROWS UNBOUNDED PRECEDING)
      AS cum_return
  FROM (
    SELECT
      a.subject_id, a.language, a.condition, a.is_sealed, a.anchor_thb,
      gs.day::date AS day,
      EXTRACT(EPOCH FROM gs.day)::bigint / 86400 AS day_num,
      EXTRACT(EPOCH FROM a.anchor_date::timestamptz)::bigint / 86400 AS anchor_day_num,
      ((ABS(hashtext(a.subject_id)) % 628) / 100.0) AS phase
    FROM (
      -- Earliest REAL snapshot per series = the anchor the walk must land on.
      SELECT DISTINCT ON (subject_id, language, condition)
        subject_id, language, condition, is_sealed,
        market_thb AS anchor_thb, captured_on AS anchor_date
      FROM public.price_snapshots
      WHERE source IS DISTINCT FROM 'estimated'
      ORDER BY subject_id, language, condition, captured_on ASC
    ) a
    CROSS JOIN LATERAL generate_series(
      a.anchor_date - INTERVAL '365 days', a.anchor_date - INTERVAL '1 day', INTERVAL '1 day'
    ) AS gs(day)
    WHERE ABS(hashtext(a.subject_id)) % 4 = 0
  ) d
) w
ON CONFLICT (subject_id, language, condition, captured_on) DO NOTHING;

-- ============ Statement 2 of 4 (bucket 1) ============
INSERT INTO public.price_snapshots
  (subject_id, language, condition, is_sealed, market_thb, market_native, currency, source, captured_on, captured_at)
SELECT
  w.subject_id, w.language, w.condition, w.is_sealed,
  GREATEST(1, ROUND(
    w.anchor_thb
    * EXP(-w.cum_return)
    * (1 + 0.035 * (SIN(2 * PI() * (w.day_num / 140.0) + w.phase)
                  - SIN(2 * PI() * (w.anchor_day_num / 140.0) + w.phase)))
  )),
  NULL, 'THB', 'estimated',
  w.day, w.day::timestamptz
FROM (
  SELECT
    d.*,
    SUM(0.0004 + 0.009 * ((hashtext(d.subject_id || '|' || d.condition || '|' || d.day::text)::bigint % 1000001) / 1000000.0))
      OVER (PARTITION BY d.subject_id, d.language, d.condition ORDER BY d.day DESC ROWS UNBOUNDED PRECEDING)
      AS cum_return
  FROM (
    SELECT
      a.subject_id, a.language, a.condition, a.is_sealed, a.anchor_thb,
      gs.day::date AS day,
      EXTRACT(EPOCH FROM gs.day)::bigint / 86400 AS day_num,
      EXTRACT(EPOCH FROM a.anchor_date::timestamptz)::bigint / 86400 AS anchor_day_num,
      ((ABS(hashtext(a.subject_id)) % 628) / 100.0) AS phase
    FROM (
      SELECT DISTINCT ON (subject_id, language, condition)
        subject_id, language, condition, is_sealed,
        market_thb AS anchor_thb, captured_on AS anchor_date
      FROM public.price_snapshots
      WHERE source IS DISTINCT FROM 'estimated'
      ORDER BY subject_id, language, condition, captured_on ASC
    ) a
    CROSS JOIN LATERAL generate_series(
      a.anchor_date - INTERVAL '365 days', a.anchor_date - INTERVAL '1 day', INTERVAL '1 day'
    ) AS gs(day)
    WHERE ABS(hashtext(a.subject_id)) % 4 = 1
  ) d
) w
ON CONFLICT (subject_id, language, condition, captured_on) DO NOTHING;

-- ============ Statement 3 of 4 (bucket 2) ============
INSERT INTO public.price_snapshots
  (subject_id, language, condition, is_sealed, market_thb, market_native, currency, source, captured_on, captured_at)
SELECT
  w.subject_id, w.language, w.condition, w.is_sealed,
  GREATEST(1, ROUND(
    w.anchor_thb
    * EXP(-w.cum_return)
    * (1 + 0.035 * (SIN(2 * PI() * (w.day_num / 140.0) + w.phase)
                  - SIN(2 * PI() * (w.anchor_day_num / 140.0) + w.phase)))
  )),
  NULL, 'THB', 'estimated',
  w.day, w.day::timestamptz
FROM (
  SELECT
    d.*,
    SUM(0.0004 + 0.009 * ((hashtext(d.subject_id || '|' || d.condition || '|' || d.day::text)::bigint % 1000001) / 1000000.0))
      OVER (PARTITION BY d.subject_id, d.language, d.condition ORDER BY d.day DESC ROWS UNBOUNDED PRECEDING)
      AS cum_return
  FROM (
    SELECT
      a.subject_id, a.language, a.condition, a.is_sealed, a.anchor_thb,
      gs.day::date AS day,
      EXTRACT(EPOCH FROM gs.day)::bigint / 86400 AS day_num,
      EXTRACT(EPOCH FROM a.anchor_date::timestamptz)::bigint / 86400 AS anchor_day_num,
      ((ABS(hashtext(a.subject_id)) % 628) / 100.0) AS phase
    FROM (
      SELECT DISTINCT ON (subject_id, language, condition)
        subject_id, language, condition, is_sealed,
        market_thb AS anchor_thb, captured_on AS anchor_date
      FROM public.price_snapshots
      WHERE source IS DISTINCT FROM 'estimated'
      ORDER BY subject_id, language, condition, captured_on ASC
    ) a
    CROSS JOIN LATERAL generate_series(
      a.anchor_date - INTERVAL '365 days', a.anchor_date - INTERVAL '1 day', INTERVAL '1 day'
    ) AS gs(day)
    WHERE ABS(hashtext(a.subject_id)) % 4 = 2
  ) d
) w
ON CONFLICT (subject_id, language, condition, captured_on) DO NOTHING;

-- ============ Statement 4 of 4 (bucket 3) ============
INSERT INTO public.price_snapshots
  (subject_id, language, condition, is_sealed, market_thb, market_native, currency, source, captured_on, captured_at)
SELECT
  w.subject_id, w.language, w.condition, w.is_sealed,
  GREATEST(1, ROUND(
    w.anchor_thb
    * EXP(-w.cum_return)
    * (1 + 0.035 * (SIN(2 * PI() * (w.day_num / 140.0) + w.phase)
                  - SIN(2 * PI() * (w.anchor_day_num / 140.0) + w.phase)))
  )),
  NULL, 'THB', 'estimated',
  w.day, w.day::timestamptz
FROM (
  SELECT
    d.*,
    SUM(0.0004 + 0.009 * ((hashtext(d.subject_id || '|' || d.condition || '|' || d.day::text)::bigint % 1000001) / 1000000.0))
      OVER (PARTITION BY d.subject_id, d.language, d.condition ORDER BY d.day DESC ROWS UNBOUNDED PRECEDING)
      AS cum_return
  FROM (
    SELECT
      a.subject_id, a.language, a.condition, a.is_sealed, a.anchor_thb,
      gs.day::date AS day,
      EXTRACT(EPOCH FROM gs.day)::bigint / 86400 AS day_num,
      EXTRACT(EPOCH FROM a.anchor_date::timestamptz)::bigint / 86400 AS anchor_day_num,
      ((ABS(hashtext(a.subject_id)) % 628) / 100.0) AS phase
    FROM (
      SELECT DISTINCT ON (subject_id, language, condition)
        subject_id, language, condition, is_sealed,
        market_thb AS anchor_thb, captured_on AS anchor_date
      FROM public.price_snapshots
      WHERE source IS DISTINCT FROM 'estimated'
      ORDER BY subject_id, language, condition, captured_on ASC
    ) a
    CROSS JOIN LATERAL generate_series(
      a.anchor_date - INTERVAL '365 days', a.anchor_date - INTERVAL '1 day', INTERVAL '1 day'
    ) AS gs(day)
    WHERE ABS(hashtext(a.subject_id)) % 4 = 3
  ) d
) w
ON CONFLICT (subject_id, language, condition, captured_on) DO NOTHING;

-- ============ Verify ============
-- Expect ~1.4M 'estimated' rows next to the small real set; earliest day ~365 days
-- back; and exactly ONE policy row - "Price snapshots are viewable within the free
-- window" with a captured_on >= ... - 91 clause. If the policy row still says
-- "viewable by everyone", re-run the policy block at the top of this file.
SELECT source, COUNT(*) AS rows, MIN(captured_on) AS first_day, MAX(captured_on) AS last_day
FROM public.price_snapshots
GROUP BY source
ORDER BY source;

SELECT polname AS policy, pg_get_expr(polqual, polrelid) AS using_clause
FROM pg_policy
WHERE polrelid = 'public.price_snapshots'::regclass;
