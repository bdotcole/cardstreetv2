-- Price-drop alerts for watched listings (lib/watchAlerts.ts).
--
-- A seller changes a price from several places (the Vault repricer, the
-- desktop Sell page, each a plain UPDATE from the browser), so the drop is
-- recorded HERE, by a trigger, rather than at any one call site: every path
-- that lowers an active listing's price queues one row, and only when
-- someone is actually watching the listing. The queue is drained by
-- notifyWatchersOfPriceDrops, which the price editors ping after a save
-- (/api/alerts/listing-price-drop) and which sweeps every pending row, not
-- just the caller's, so a missed ping is caught by the next one.
--
-- Rows are claimed by setting notified_at (compare-and-swap on NULL), so two
-- concurrent sweeps never alert twice. Service-role only: RLS on, no policies.
--
-- Depends on 20261015_listing_watches.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.listing_price_drops (
  id          BIGSERIAL PRIMARY KEY,
  listing_id  UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  old_price   NUMERIC(10,2) NOT NULL,
  new_price   NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);

-- The sweep reads pending rows only; the sent back catalogue stays off it.
CREATE INDEX IF NOT EXISTS listing_price_drops_pending_idx
  ON public.listing_price_drops (created_at)
  WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS listing_price_drops_listing_idx
  ON public.listing_price_drops (listing_id, notified_at DESC);

ALTER TABLE public.listing_price_drops ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.queue_listing_price_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A drop on a live listing, and only when it has an audience: an unwatched
  -- listing would queue rows nobody will ever be told about.
  IF NEW.price < OLD.price
     AND NEW.status = 'active'
     AND EXISTS (SELECT 1 FROM public.listing_watches w WHERE w.listing_id = NEW.id)
  THEN
    INSERT INTO public.listing_price_drops (listing_id, old_price, new_price)
    VALUES (NEW.id, OLD.price, NEW.price);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_listing_price_drop ON public.listings;
CREATE TRIGGER trg_queue_listing_price_drop
  AFTER UPDATE OF price ON public.listings
  FOR EACH ROW
  WHEN (NEW.price IS DISTINCT FROM OLD.price)
  EXECUTE FUNCTION public.queue_listing_price_drop();
