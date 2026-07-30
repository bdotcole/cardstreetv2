-- Turn the one-shot "finish your Stripe payout setup" reminder into a short
-- multi-touch sequence (app/api/cron/stripe-setup-nudge +
-- lib/courier.ts:sendStripeSetupReminderEmail).
--
-- Why: the 2026-07-16 funnel showed the single email is saturated and not
-- converting — 34 of 38 stalled sellers had already received it and were still
-- stalled. One email, ever, is not enough follow-up for a KYC form people
-- bounce off. The sender now sends up to 3 touches spaced >=48h apart, across
-- email + push.
--
-- stripe_setup_nudge_count is the CAS token: the sender claims a touch with
-- `SET count = old+1 WHERE count = old`, so concurrent cron runs can never
-- double-send. It also bounds the sequence (stop at 3).

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_setup_nudge_count INT NOT NULL DEFAULT 0;

-- Sellers already nudged under the old one-shot scheme have had exactly one
-- touch. Without this they'd restart the sequence from zero and get a
-- duplicate first touch.
UPDATE public.profiles
SET stripe_setup_nudge_count = 1
WHERE stripe_setup_nudge_sent_at IS NOT NULL
  AND stripe_setup_nudge_count = 0;

COMMENT ON COLUMN public.profiles.stripe_setup_nudge_count IS
    'How many "finish your Stripe payout setup" touches have been sent (0-3). CAS token for the sender; also bounds the sequence.';

-- Semantics change: this used to mean "the one-time reminder was sent"
-- (NULL = never). It now means "when the most recent touch was sent" and is
-- what the >=48h spacing check compares against.
COMMENT ON COLUMN public.profiles.stripe_setup_nudge_sent_at IS
    'When the most recent "finish your Stripe payout setup" touch was sent. NULL = none sent yet. Paired with stripe_setup_nudge_count for spacing.';
