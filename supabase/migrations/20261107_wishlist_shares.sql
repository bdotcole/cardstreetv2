-- Shareable wishlists.
--
-- A collector shares the cards they are hoping for as a link,
-- cardstreet.app/wishlist/<token> (the 2026 holiday "hint at your gift"
-- promotion is the first use). The token is an opaque random string minted by
-- /api/wishlist/share, never the user id, so no wishlist can be opened by
-- guessing an account. Turning the link off keeps the row (enabled = false);
-- turning it back on mints a NEW token, so a link that was turned off stays
-- dead for whoever still has it.
--
-- Its own table, not columns on profiles: profiles is readable by every
-- signed-in user, so a token column there would hand every wishlist to
-- everyone. Here the owner is the only one who can read their row, and the
-- public read goes through public_wishlist_by_token(), which returns the
-- cards and the owner's display fields and nothing else.
--
-- Safe to re-run. Until it runs, /api/wishlist/share answers "not available"
-- and the share sheet says so; /wishlist/<token> is a 404.

CREATE TABLE IF NOT EXISTS public.wishlist_shares (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 8 AND 64),
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wishlist_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wishlist_shares_select_own ON public.wishlist_shares;
CREATE POLICY wishlist_shares_select_own ON public.wishlist_shares
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS wishlist_shares_insert_own ON public.wishlist_shares;
CREATE POLICY wishlist_shares_insert_own ON public.wishlist_shares
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS wishlist_shares_update_own ON public.wishlist_shares;
CREATE POLICY wishlist_shares_update_own ON public.wishlist_shares
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.wishlist_shares TO authenticated;

-- The public read. SECURITY DEFINER so an anonymous visitor with the link can
-- read the wishlist rows (whose RLS is owner-only) and the owner's display
-- fields, while the token itself never leaves the owner's row. Returns NULL
-- for an unknown or turned-off token and for a banned account. priceHistory
-- is dropped from each card snapshot: it is the bulk of the blob and the page
-- does not chart.
CREATE OR REPLACE FUNCTION public.public_wishlist_by_token(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'owner', jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'username', p.username,
      'avatar_url', p.avatar_url
    ),
    'shared_at', s.updated_at,
    'cards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'card_id', w.card_id,
          'card_data', w.card_data - 'priceHistory',
          'added_at', w.added_at
        )
        ORDER BY w.added_at DESC
      )
      FROM public.wishlists w
      WHERE w.user_id = s.user_id
    ), '[]'::jsonb)
  )
  FROM public.wishlist_shares s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.token = p_token
    AND s.enabled
    AND p.banned_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.public_wishlist_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_wishlist_by_token(TEXT) TO anon, authenticated;
