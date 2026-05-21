-- =============================================================================
-- Dual-region Stripe Connect: US + TH platforms
-- =============================================================================
-- We're adding a second Stripe platform (Stripe Thailand) under the same Stripe
-- organization so we can accept THB and PromptPay natively. The existing US
-- platform stays. A seller's connected account lives on exactly one platform,
-- recorded by `stripe_region`. Checkout, webhooks, and release-funds all route
-- by that value.
--
-- `preferred_currency` is buyer/seller display currency in the app and is the
-- signal a new seller's onboarding flow uses to pick which platform to create
-- their Express account on.
--
-- Connect onboarding still sets `country='TH'` on the connected account either
-- way — what changes is which platform owns it. On the US platform the seller
-- accepts the `recipient` service agreement (CardStreet is MOR). On the TH
-- platform the seller is local and accepts the standard merchant agreement.
-- =============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_region TEXT
        CHECK (stripe_region IN ('us', 'th')),
    ADD COLUMN IF NOT EXISTS preferred_currency TEXT NOT NULL DEFAULT 'thb'
        CHECK (preferred_currency IN ('usd', 'thb'));

-- Backfill: any profile with an existing stripe_account_id is on the US
-- platform (the only one that existed before this migration).
UPDATE public.profiles
SET stripe_region = 'us'
WHERE stripe_account_id IS NOT NULL
  AND stripe_region IS NULL;

-- =============================================================================
-- Orders: track which platform processed the payment so release-funds knows
-- which Stripe client to use when creating the seller transfer. Without this,
-- a payout job would have to look up the seller's current region — but a
-- seller could (theoretically) move regions later, and the transfer must
-- happen on the platform that originally charged the buyer.
-- =============================================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS stripe_region TEXT
        CHECK (stripe_region IN ('us', 'th'));

-- Backfill: every pre-existing order was processed on the US platform.
UPDATE public.orders
SET stripe_region = 'us'
WHERE stripe_region IS NULL;
