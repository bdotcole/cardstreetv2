-- CardStreet Pro perks: wishlist listing alerts.
-- (The 5% Pro seller rate is code-only -- app/api/orders/checkout/route.ts.)

-- 1) Alert log. Dedupes sends (one alert per user+card per 24h, enforced in
--    lib/wishlistAlerts.ts) and gives a future in-app alert feed a source.
CREATE TABLE IF NOT EXISTS public.wishlist_alert_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    listing_id UUID REFERENCES public.listings(id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wishlist_alert_log_user_card
    ON public.wishlist_alert_log (user_id, card_id, sent_at DESC);

ALTER TABLE public.wishlist_alert_log ENABLE ROW LEVEL SECURITY;

-- Writes are service-role only (no INSERT policy on purpose). Users may read
-- their own alert history.
DROP POLICY IF EXISTS "Users can view own wishlist alerts" ON public.wishlist_alert_log;
CREATE POLICY "Users can view own wishlist alerts"
    ON public.wishlist_alert_log FOR SELECT
    USING (auth.uid() = user_id);

-- 2) Per-user opt-out toggles, matching the existing sold/label/shipped pairs.
ALTER TABLE public.notification_preferences
    ADD COLUMN IF NOT EXISTS wishlist_email BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS wishlist_push BOOLEAN NOT NULL DEFAULT true;

-- 3) The fan-out looks wishlists up BY CARD; only (user_id, card_id) existed.
CREATE INDEX IF NOT EXISTS idx_wishlists_card_id ON public.wishlists (card_id);
