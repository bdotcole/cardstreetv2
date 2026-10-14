-- Follow a shop.
--
-- The seller page has carried a Follow button since launch with nothing behind
-- it. A buyer reported (2026-10-14) tapping it, then trying to search for the
-- shop to find it again, and getting nowhere on both. This makes Follow real:
--
--   1. seller_follows — one row per (follower, shop). The follower writes and
--      deletes their own rows; each side can read the rows that involve them
--      (my Following list, my Followers list). Nobody can list a third
--      party's followers.
--   2. follow_counts(user) — follower + following totals for any profile,
--      readable by anon too, so a shop page can show its follower count
--      without exposing who the followers are.
--
-- Safe to re-run. Until it runs, /api/follows answers "not available" and the
-- app hides the counts; the Follow button reports that it could not save.

CREATE TABLE IF NOT EXISTS public.seller_follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, seller_id),
  CONSTRAINT seller_follows_not_self CHECK (follower_id <> seller_id)
);

-- The primary key serves "who do I follow"; this serves "who follows me" and
-- the follower count.
CREATE INDEX IF NOT EXISTS seller_follows_seller_idx
  ON public.seller_follows (seller_id, created_at DESC);

ALTER TABLE public.seller_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_follows_select_own ON public.seller_follows;
CREATE POLICY seller_follows_select_own ON public.seller_follows
  FOR SELECT TO authenticated
  USING (follower_id = auth.uid() OR seller_id = auth.uid());

DROP POLICY IF EXISTS seller_follows_insert_own ON public.seller_follows;
CREATE POLICY seller_follows_insert_own ON public.seller_follows
  FOR INSERT TO authenticated
  WITH CHECK (follower_id = auth.uid());

DROP POLICY IF EXISTS seller_follows_delete_own ON public.seller_follows;
CREATE POLICY seller_follows_delete_own ON public.seller_follows
  FOR DELETE TO authenticated
  USING (follower_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.seller_follows TO authenticated;

-- Counts only, never ids: SECURITY DEFINER so a shop page can show its total
-- to anyone while the rows themselves stay behind the policies above.
CREATE OR REPLACE FUNCTION public.follow_counts(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'followers', (SELECT count(*) FROM public.seller_follows WHERE seller_id = p_user_id),
    'following', (SELECT count(*) FROM public.seller_follows WHERE follower_id = p_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.follow_counts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.follow_counts(UUID) TO anon, authenticated;
