-- =============================================================================
-- Stripe Connect (Express) seller onboarding columns
-- =============================================================================
-- The release-funds edge function reads profiles.stripe_account_id but the
-- column was never created. Without it, every payout silently skips with
-- "No Stripe Connect account". This migration adds the column and the
-- supporting flags we need to gate UI and avoid futile transfer attempts.
-- =============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_account_status TEXT
        CHECK (stripe_account_status IN ('pending', 'enabled', 'restricted', 'rejected')),
    ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS stripe_account_updated_at TIMESTAMPTZ;

-- Lookup index for the Stripe webhook (account.updated → find profile by acct id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_account_id
    ON public.profiles(stripe_account_id)
    WHERE stripe_account_id IS NOT NULL;
