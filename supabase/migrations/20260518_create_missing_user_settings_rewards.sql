-- The 20260128_profile_features.sql migration was never applied to the live DB,
-- so handle_new_user() was failing on the missing public.user_settings table.
-- This recreates only the two tables required by the auth trigger (user_settings
-- and rewards). payment_methods/orders from the same legacy migration are not
-- needed: orders was recreated by 20260221_orders_schema.sql with a different
-- schema, and payment_methods isn't referenced by any current code path.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number TEXT,
  shipping_address JSONB DEFAULT '{}',
  two_factor_enabled BOOLEAN DEFAULT false,
  notify_price_drops BOOLEAN DEFAULT true,
  notify_order_updates BOOLEAN DEFAULT true,
  notify_marketing BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
CREATE POLICY "Users can view own settings"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.rewards (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  points_balance INTEGER DEFAULT 0,
  tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  lifetime_points INTEGER DEFAULT 0,
  tier_progress INTEGER DEFAULT 0,
  last_points_earned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own rewards" ON public.rewards;
CREATE POLICY "Users can view own rewards"
  ON public.rewards FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own rewards" ON public.rewards;
CREATE POLICY "Users can insert own rewards"
  ON public.rewards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own rewards" ON public.rewards;
CREATE POLICY "Users can update own rewards"
  ON public.rewards FOR UPDATE
  USING (auth.uid() = user_id);

INSERT INTO public.user_settings (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.rewards (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
