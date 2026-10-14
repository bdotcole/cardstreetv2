-- Watch a listing.
--
-- A buyer can watch a listing; every listing tile shows how many people are
-- watching it in place of the condition badge (2026-10-14 founder ask: the
-- count is a nudge for buyers who are on the fence). Modelled on
-- 20261014_seller_follows.sql:
--
--   1. listing_watches — one row per (user, listing). The watcher writes and
--      deletes their own rows and can read only their own (their watchlist).
--      Nobody can list who watches a listing, and a seller cannot watch their
--      own listing (the count would be theirs to inflate).
--   2. listing_watch_counts(ids) — the per-listing totals, readable by anon,
--      so a grid of tiles shows every count in one call without exposing who
--      the watchers are.
--
-- Also adds the index the new grade / grading-company filters read.
--
-- Safe to re-run. Until it runs, /api/listings/watch answers "not available",
-- tiles show no count, and the Watch button reports that it could not save.

CREATE TABLE IF NOT EXISTS public.listing_watches (
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  listing_id     UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  -- The asking price when the watch began, so the Watching list can say
  -- "was 1,200" next to a card that has since come down.
  price_at_watch NUMERIC(10,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

ALTER TABLE public.listing_watches
  ADD COLUMN IF NOT EXISTS price_at_watch NUMERIC(10,2);

-- The primary key serves "what do I watch"; this serves the per-listing count.
CREATE INDEX IF NOT EXISTS listing_watches_listing_idx
  ON public.listing_watches (listing_id);

ALTER TABLE public.listing_watches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_watches_select_own ON public.listing_watches;
CREATE POLICY listing_watches_select_own ON public.listing_watches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- The seller cannot watch their own listing: the count on their tile would be
-- theirs to pad. Checked here as well as in the route.
DROP POLICY IF EXISTS listing_watches_insert_own ON public.listing_watches;
CREATE POLICY listing_watches_insert_own ON public.listing_watches
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = listing_id AND l.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS listing_watches_delete_own ON public.listing_watches;
CREATE POLICY listing_watches_delete_own ON public.listing_watches
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.listing_watches TO authenticated;

-- Counts only, never ids: SECURITY DEFINER so a tile can show its total to
-- anyone while the rows themselves stay behind the policies above. Listings
-- with no watchers are simply absent from the result.
CREATE OR REPLACE FUNCTION public.listing_watch_counts(p_listing_ids UUID[])
RETURNS TABLE (listing_id UUID, watchers BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.listing_id, count(*)::BIGINT AS watchers
  FROM public.listing_watches w
  WHERE w.listing_id = ANY (p_listing_ids)
  GROUP BY w.listing_id;
$$;

REVOKE ALL ON FUNCTION public.listing_watch_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listing_watch_counts(UUID[]) TO anon, authenticated;

-- Grade / grading-company filters on the marketplace read these two columns
-- over the active graded rows only.
CREATE INDEX IF NOT EXISTS listings_active_graded_idx
  ON public.listings (grading_company, grade)
  WHERE status = 'active' AND is_graded = true;
