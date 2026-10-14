-- Default shop minimum order for sellers who never set one.
--
-- Shops left at "no minimum" sold single ฿20 cards and paid the Flash freight
-- out of the sale (order 4c3cd9d9, 2026-10-14). Founder decision: a shop that
-- never chose a minimum gets ฿60; a seller can still pick any amount or turn
-- it off.
--
-- min_order_thb now distinguishes the two cases:
--   NULL  = never set   -> the app enforces DEFAULT_MIN_ORDER_THB (lib/minOrder.ts)
--   0     = turned off by the seller
--   N > 0 = the seller's own minimum
-- The default lives in code, not in a stored 60, so a seller who chose ฿60
-- stays distinguishable from one who never chose, and the default can change
-- without rewriting rows.
--
-- Every 0 today is the old column default: 0 was also the "off" value, so a
-- seller who deliberately saved 0 cannot be told apart and moves to the
-- default too. 8 shops had a minimum above 0 on 2026-10-14; they keep it.
--
-- The CHECK (0..5000) passes NULL. public_profiles reads the column as is.
-- Safe to re-run. Either deploy order is safe: old code reads NULL as "no
-- minimum", new code reads 0 as "off".

ALTER TABLE public.profiles
  ALTER COLUMN min_order_thb DROP NOT NULL,
  ALTER COLUMN min_order_thb DROP DEFAULT;

UPDATE public.profiles
SET min_order_thb = NULL
WHERE min_order_thb = 0;
