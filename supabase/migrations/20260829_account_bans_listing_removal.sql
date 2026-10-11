-- Account bans + admin listing removal.
--
-- Banning is enforced in three layers:
--   1. GoTrue (auth.users.banned_until) — set by the admin API with a ~10-year
--      ban_duration. Blocks sign-in and token refresh; an existing access
--      token survives at most 1h.
--   2. profiles.banned_at / banned_reason — the app-visible flag (this file).
--   3. RESTRICTIVE RLS on listings (this file) — closes the ≤1h stale-token
--      window during which a just-banned user could still write listings
--      directly from the client.
--
-- Admin listing removal uses a new status 'removed', distinct from the
-- seller-initiated 'cancelled', so moderation actions stay auditable. Every
-- buyer-facing query filters status='active' and seller manage views filter
-- ('active','draft'), so 'removed' disappears from both without further code.
-- The application fails soft until this runs: the admin remove action falls
-- back to 'cancelled', and ban actions still enforce via GoTrue.
--
-- Idempotent: safe to run more than once from the SQL Editor.

-- 1. Ban flags on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned_reason TEXT;

COMMENT ON COLUMN public.profiles.banned_at IS
    'Set when an admin bans the account. Mirrors a GoTrue ban (auth.users.banned_until); the GoTrue ban is what blocks sign-in.';

-- 2. Allow status='removed' on listings (admin moderation removal)
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
    CHECK (status IN ('active', 'sold', 'cancelled', 'draft', 'removed'));
END $$;

COMMENT ON COLUMN public.listings.status IS
    'active | sold (also the checkout reservation state) | cancelled (seller-initiated) | draft (created before Stripe onboarding finished; owner-only via RLS, auto-published when stripe_details_submitted flips true) | removed (taken down by an admin)';

-- 3. Banned users cannot write listings, even with a still-valid access token.
-- RESTRICTIVE policies AND with the existing permissive ones, so nothing is
-- newly granted — only further restricted. service_role bypasses RLS, so
-- admin tooling and crons are unaffected.
DROP POLICY IF EXISTS "banned_users_cannot_insert_listings" ON public.listings;
CREATE POLICY "banned_users_cannot_insert_listings" ON public.listings
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (
        NOT EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.banned_at IS NOT NULL
        )
    );

DROP POLICY IF EXISTS "banned_users_cannot_update_listings" ON public.listings;
CREATE POLICY "banned_users_cannot_update_listings" ON public.listings
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (
        NOT EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.banned_at IS NOT NULL
        )
    );
