-- One row per failed payment attempt (Stripe payment_intent.payment_failed),
-- written by the webhook (lib/stripeWebhook.ts -> recordPaymentFailure).
--
-- Before this, why a payment failed lived only in each seller's own Stripe
-- dashboard: the webhook cancels the order and keeps nothing, so "are foreign
-- cards failing, and why?" could not be answered from our side. Card country,
-- funding (credit/debit/prepaid), wallet, decline codes and the 3DS result are
-- the fields that answer it.
--
-- RLS on with no policies: the webhook writes with the service role, and it is
-- read from the SQL editor. Nothing here is card data in the PCI sense (no
-- PAN, no expiry): brand/country/funding are what Stripe exposes to merchants.

create table if not exists public.payment_failures (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    stripe_event_id text not null unique,
    payment_intent_id text not null,
    transfer_group text,
    stripe_account_id text,
    amount_satang bigint,
    currency text,
    method_type text,
    error_type text,
    error_code text,
    decline_code text,
    network_decline_code text,
    outcome_type text,
    outcome_reason text,
    risk_level text,
    card_brand text,
    card_country text,
    card_funding text,
    card_wallet text,
    three_ds_result text
);

create index if not exists payment_failures_created_at_idx
    on public.payment_failures (created_at desc);

alter table public.payment_failures enable row level security;
