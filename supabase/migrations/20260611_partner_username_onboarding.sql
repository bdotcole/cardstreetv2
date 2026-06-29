-- Username + temp-password partner onboarding.
--
-- Admin creates a partner with a shop name, an ASCII username, and a temporary
-- password — no email needed up front. The auth user is created with a stable
-- synthetic login email (<username>@partner.cardstreet.app) that is never shown
-- to anyone; the partner signs in the first time with username + temp password.
-- A forced first-login flow then collects their real email (which replaces the
-- synthetic one as the account email), phone, and a new password.
--
-- partner_onboarding_complete gates that forced flow. DEFAULT true so existing
-- users and self-serve signups are never gated; only admin-provisioned partner
-- accounts are explicitly set to false at creation and flipped to true when the
-- partner finishes setup.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS partner_onboarding_complete BOOLEAN NOT NULL DEFAULT true;

-- Marks an account whose auth email is still the synthetic login placeholder.
-- Lets the admin UI show "pending activation" instead of the fake email, and
-- lets us refuse to send real mail to a placeholder address.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS has_placeholder_email BOOLEAN NOT NULL DEFAULT false;
