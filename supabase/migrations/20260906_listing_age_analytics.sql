-- Listing age analytics: when a listing actually sold, and when it was last
-- nudged about being stale.
--
-- WHY sold_at CANNOT BE DERIVED FROM WHAT EXISTS: listings.status flips to
-- 'sold' at CHECKOUT, as a reservation (app/api/orders/checkout ~line 601), and
-- flips back to 'active' when the checkout dies. So a 'sold' row's
-- created_at..updated_at spans "time until somebody began a checkout", not time
-- to sale, and a listing that was reserved, released and later genuinely sold
-- carries no trace of either event. updated_at is worse still — every price
-- edit moves it.
--
-- sold_at is written by lib/fulfillOrder.ts on the settle (the CAS win that
-- flips orders pending_payment -> paid), which is the one moment a sale is
-- real. It is never overwritten: the writer guards on sold_at IS NULL so a
-- retried webhook or the /api/orders/finalize fallback cannot move it.
--
-- Both columns are nullable with no default and no backfill. A default of now()
-- would stamp every historical row with the migration date and produce a fake
-- cohort; the existing sales genuinely have no known sale time, and a NULL says
-- so honestly. Analytics should read "sold_at IS NOT NULL" as "sold since
-- 2026-09-06", not as the whole history.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_nudged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.listings.sold_at IS
  'When the sale actually settled (written at fulfillment, never overwritten). '
  'NULL for unsold listings AND for every sale before 2026-09-06 — status=''sold'' '
  'is a checkout-time reservation and cannot be used to backfill this.';

COMMENT ON COLUMN public.listings.stale_nudged_at IS
  'Last time the seller was nudged to reprice this listing '
  '(app/api/cron/stale-listings). Enforces the 30-day re-nudge cooldown.';

-- The stale-listing cron scans active listings by age; the partial index keeps
-- that scan off the sold/draft back catalogue, which is most of the table.
CREATE INDEX IF NOT EXISTS idx_listings_active_created
  ON public.listings (created_at)
  WHERE status = 'active';

-- Time-to-sale queries filter to rows that HAVE a sale time.
CREATE INDEX IF NOT EXISTS idx_listings_sold_at
  ON public.listings (sold_at)
  WHERE sold_at IS NOT NULL;

-- Age analytics, once rows accumulate:
--   SELECT date_trunc('week', sold_at) AS week,
--          count(*),
--          percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_at - created_at) AS median_age
--   FROM public.listings
--   WHERE sold_at IS NOT NULL
--   GROUP BY 1 ORDER BY 1;
