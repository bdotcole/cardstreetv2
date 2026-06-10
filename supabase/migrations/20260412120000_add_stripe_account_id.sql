-- Add stripe_account_id to profiles to support Stripe Connect
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transfer_group TEXT;
