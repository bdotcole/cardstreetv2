-- Premium billing: link subscription ledger rows to the Stripe customer.
--
-- Needed by the billing-portal route (manage/cancel) — Stripe's portal session
-- is created against a customer id, which checkout.session.completed gives us
-- via the subscription object. Apply after 20260627_premium_entitlements.sql.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
  ON subscriptions (provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;
