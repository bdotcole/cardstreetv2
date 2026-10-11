-- Shop minimum order.
--
-- Shipping now lives inside every listing price, which makes a one-card order
-- of a 10-baht common a loss for the seller: the parcel costs 30-40 baht
-- whatever is in it. Pricing every common at 50 baht to cover that would make
-- bulk unbuyable. A shop-level minimum order is the way through: the seller
-- lists commons at 10 baht each, sets a 100-baht minimum, and a buyer building
-- a deck takes ten of them in one parcel. Founder decision 2026-09-29, in place
-- of seller-defined bundle discounts.
--
--   1. profiles.min_order_thb — whole baht, 0 = no minimum. Capped at 5000 so
--      a typo cannot make a shop unbuyable.
--   2. public_profiles exposes it, so the cart, the listing sheet and the
--      seller page can tell the buyer before checkout refuses them. Appended
--      as the last column: CREATE OR REPLACE VIEW may only add at the end.
--
-- Enforcement is server-side in /api/orders/estimate and /api/orders/checkout.
-- Everything reading the column fails soft until this runs (no minimums).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS min_order_thb INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_min_order_thb_range;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_min_order_thb_range
  CHECK (min_order_thb >= 0 AND min_order_thb <= 5000);

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
  p.shop_paused_at,
  p.min_order_thb
FROM public.profiles p
LEFT JOIN public.rewards r ON r.user_id = p.id;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
