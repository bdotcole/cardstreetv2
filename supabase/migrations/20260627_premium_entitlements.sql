-- Premium entitlements primitive.
--
-- Foundation for the paid "Pro" tier that gates future premium features
-- (AI grader, trade finder, advanced market tools). This migration adds ONLY
-- the entitlement backbone -- no billing. Real purchases (Stripe on web,
-- Apple/Google IAP via RevenueCat in the apps) will write `premium_until`
-- through their webhooks later; for now it is granted manually via the admin
-- route (provider='manual'), which is how we dogfood premium before any
-- payment rail exists.
--
-- Design:
--   * profiles.premium_until = cached entitlement, the fast read every gate
--     uses (and future RLS on premium-only tables). Written ONLY by
--     service-role -- a trigger blocks self-grants, since users can otherwise
--     update their own profile row.
--   * subscriptions = the source-of-truth ledger each billing rail writes to.

-- 1. Cached entitlement on the profile. NULL = never subscribed.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;

-- 2. Block non-service-role sessions from writing premium_until. The existing
--    "Users can update own profile" policy (USING auth.uid() = id) would
--    otherwise let any user self-grant premium with a single UPDATE. Normal
--    profile edits (display_name, avatar, ...) leave premium_until unchanged
--    and pass straight through.
CREATE OR REPLACE FUNCTION public.protect_premium_until()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.premium_until IS DISTINCT FROM OLD.premium_until
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'premium_until is read-only; entitlement is set by billing webhooks';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_premium_until ON profiles;
CREATE TRIGGER protect_premium_until
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_premium_until();

-- 3. Subscriptions ledger -- one row per (rail, external subscription). Written
--    only by service-role (webhooks / admin); users may read their own.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL
                             CHECK (provider IN ('stripe', 'app_store', 'play_store', 'revenuecat', 'manual')),
  platform                 TEXT
                             CHECK (platform IN ('web', 'ios', 'android')),
  provider_subscription_id TEXT,
  product_id               TEXT,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired', 'paused')),
  current_period_end       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One ledger row per real external subscription; manual/comp rows carry a NULL
-- external id and are exempt from the uniqueness guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_ref
  ON subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON subscriptions (status);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users may read their own subscriptions; every write goes through service-role
-- (no INSERT/UPDATE/DELETE policy => blocked for authenticated, allowed for
-- service-role, which bypasses RLS).
DROP POLICY IF EXISTS "Users can view own subscriptions" ON subscriptions;
CREATE POLICY "Users can view own subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Reusable entitlement predicate for app code and future RLS on
--    premium-only tables, e.g.  USING (public.is_premium(auth.uid())).
CREATE OR REPLACE FUNCTION public.is_premium(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND premium_until > NOW()
  );
$$;
