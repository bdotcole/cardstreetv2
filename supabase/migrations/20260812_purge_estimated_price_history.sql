-- Purge the fabricated price-history rows seeded by 20260710_price_history_estimated_backfill.sql.
--
-- Those rows (source='estimated') were a deterministic random walk backward from each
-- series' first real snapshot — a stopgap so the 30d/90d/180d/1y chart ranges had
-- something to draw while real history accrued. That need is gone: the 2026-08-11
-- JustTCG sweep wrote ~2.28M REAL daily points covering every JustTCG-priced card
-- (~57k across all six games), and batch-price-english / batch-price-games now merge
-- fresh 90d history on every nightly run. Keeping the estimates would mean shipping
-- invented prices next to real ones, indistinguishable to the user.
--
-- Impact, measured against the live DB on 2026-08-12 before writing this file:
--   * 3,818 series carry estimated rows; 3,810 of them also have real data, so the
--     purge only shortens their charts to the honest window.
--   * 8 series lose their chart entirely — th-SV4a-321/322/325/326/331/332/334/342.
--     Those are 100% fabricated today (zero real rows), so a hidden chart is the
--     correct outcome; PriceHistoryChart self-hides when a series has <2 points.
--   * /api/price-history forward-fills between stored points, so the remaining real
--     rows still render as continuous daily lines, not gapped ones.
--
-- Run in the Supabase SQL Editor (the founder does not use the CLI). Sliced by date
-- so each statement gets its own timeout budget — a single 1.39M-row DELETE can trip
-- the statement timeout and roll back the whole thing. Run TOP TO BOTTOM; each
-- statement is independently idempotent and safe to re-run.

-- ============ Statement 1 of 5 ============
DELETE FROM public.price_snapshots
WHERE source = 'estimated' AND captured_on < DATE '2025-10-01';

-- ============ Statement 2 of 5 ============
DELETE FROM public.price_snapshots
WHERE source = 'estimated' AND captured_on >= DATE '2025-10-01' AND captured_on < DATE '2026-01-01';

-- ============ Statement 3 of 5 ============
DELETE FROM public.price_snapshots
WHERE source = 'estimated' AND captured_on >= DATE '2026-01-01' AND captured_on < DATE '2026-04-01';

-- ============ Statement 4 of 5 ============
DELETE FROM public.price_snapshots
WHERE source = 'estimated' AND captured_on >= DATE '2026-04-01' AND captured_on < DATE '2026-07-01';

-- ============ Statement 5 of 5 ============
DELETE FROM public.price_snapshots
WHERE source = 'estimated' AND captured_on >= DATE '2026-07-01';

-- ============ Verify ============
-- Expect NO 'estimated' row, and the real sources intact (~2.3M justtcg,
-- ~129k pricecharting, ~4.5k catalog).
SELECT source, COUNT(*) AS rows, MIN(captured_on) AS first_day, MAX(captured_on) AS last_day
FROM public.price_snapshots
GROUP BY source
ORDER BY source;
