-- One-shot guard for the stalled-onboarding reminder email
-- (app/api/cron/stripe-setup-nudge). NULL = never nudged. The sender
-- compare-and-swaps this column before dispatching (same pattern as
-- first_sale_email_sent_at) so concurrent cron runs can never double-email.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_setup_nudge_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.stripe_setup_nudge_sent_at IS
    'When the one-time "finish your Stripe payout setup" reminder email was sent. NULL = not yet sent.';
