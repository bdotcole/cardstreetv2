-- Seller shop pause ("vacation mode").
--
-- A seller can pause their whole shop from Profile > Seller Account. While
-- paused nothing of theirs can be bought; reopening puts every listing back
-- exactly as it was. Two pieces make that hold everywhere at once:
--
--   1. listings.status gains 'paused'. Pausing flips the seller's 'active'
--      rows to 'paused', reopening flips them back. Every buyer-facing query
--      already filters status = 'active', the checkout reservation is a CAS
--      on 'active', and the SELECT policy hides non-active rows from anyone
--      but the owner -- so a paused listing disappears from the marketplace,
--      card pages, search, wishlist alerts and checkout without touching any
--      of those call sites.
--
--   2. A BEFORE trigger converts any write of status = 'active' into 'paused'
--      while the seller is paused. Several code paths flip a listing back to
--      'active' on their own (draft publish once Stripe finishes, the
--      checkout-abandoned rollback from 'sold', the payment-failed webhook,
--      lib/fulfillOrder), and a new listing created mid-pause inserts as
--      'active'. Without the trigger each of those would leak a buyable
--      listing into a shop that is supposed to be closed.
--
-- profiles.shop_paused_at is the seller-facing source of truth (drives the
-- toggle and the "shop paused" notice on the public seller page). The flag and
-- the listing flip happen in one transaction inside set_shop_paused(), so
-- there is no window where the two disagree.
--
-- Everything fails soft until this runs: the API reports the feature as
-- unavailable and the toggle stays hidden.

-- ============================================================================
-- 1. profiles.shop_paused_at
-- ============================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shop_paused_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.shop_paused_at IS
    'Set while the seller has paused their shop (vacation mode). NULL = open. Toggled only through set_shop_paused().';

-- ============================================================================
-- 2. Allow status = 'paused' on listings
-- ============================================================================
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.listings'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.listings DROP CONSTRAINT %I', con.conname);
  END LOOP;

  ALTER TABLE public.listings
    ADD CONSTRAINT listings_status_check
    CHECK (status IN ('active', 'sold', 'cancelled', 'draft', 'removed', 'paused'));
END $$;

COMMENT ON COLUMN public.listings.status IS
    'active | sold (also the checkout reservation state) | cancelled (seller-initiated) | draft (created before Stripe onboarding finished; owner-only via RLS, auto-published when stripe_details_submitted flips true) | removed (taken down by an admin) | paused (seller paused their whole shop; owner-only via RLS, restored to active when the shop reopens)';

-- Pausing flips the seller's whole active inventory in one statement and the
-- owner surfaces list active + draft + paused together.
CREATE INDEX IF NOT EXISTS listings_seller_status_idx
    ON public.listings (seller_id, status);

-- ============================================================================
-- 3. Hold any 'active' write while the shop is paused
-- ============================================================================
-- SECURITY DEFINER so the profile lookup never depends on the caller's RLS
-- (a buyer's checkout rollback and the service-role crons both write here).
-- Fails open: an unexpected error must never block a listing write.
CREATE OR REPLACE FUNCTION public.trg_hold_listing_while_shop_paused()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.seller_id AND p.shop_paused_at IS NOT NULL
  ) THEN
    NEW.status := 'paused';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hold_listing_while_shop_paused ON public.listings;
CREATE TRIGGER trg_hold_listing_while_shop_paused
  BEFORE INSERT OR UPDATE OF status ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_hold_listing_while_shop_paused();

-- ============================================================================
-- 4. set_shop_paused(p_paused) -- the only writer of shop_paused_at
-- ============================================================================
-- Runs as the signed-in seller (auth.uid()), so there is no seller id to
-- spoof. Returns the number of listings flipped. Reopening clears the flag
-- BEFORE restoring listings, otherwise the trigger above would turn every
-- restore straight back into 'paused'.
CREATE OR REPLACE FUNCTION public.set_shop_paused(p_paused BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_seller UUID := auth.uid();
  v_count INTEGER := 0;
BEGIN
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'set_shop_paused requires a signed-in user' USING ERRCODE = '42501';
  END IF;

  IF p_paused THEN
    UPDATE public.profiles
      SET shop_paused_at = COALESCE(shop_paused_at, NOW())
      WHERE id = v_seller;

    UPDATE public.listings
      SET status = 'paused'
      WHERE seller_id = v_seller AND status = 'active';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    UPDATE public.profiles
      SET shop_paused_at = NULL
      WHERE id = v_seller;

    UPDATE public.listings
      SET status = 'active'
      WHERE seller_id = v_seller AND status = 'paused';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_shop_paused(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_shop_paused(BOOLEAN) TO authenticated;

-- ============================================================================
-- 5. Expose the flag on the public seller view (append-only, non-sensitive)
-- ============================================================================
-- The public seller page shows a "shop paused" notice instead of an empty
-- grid that reads as a dead shop.
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = off) AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  p.bio,
  p.partner_tier,
  p.partner_qr_slug,
  p.partner_joined_at,
  p.rating,
  p.review_count,
  p.is_verified_shop,
  p.created_at,
  (p.role = 'admin') AS is_official,
  COALESCE(r.level, 1) AS reward_level,
  COALESCE(r.displayed_badges, '{}') AS displayed_badges,
  r.equipped_frame,
  r.equipped_chat_color,
  p.shop_paused_at
FROM public.profiles p
LEFT JOIN public.rewards r ON r.user_id = p.id;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
