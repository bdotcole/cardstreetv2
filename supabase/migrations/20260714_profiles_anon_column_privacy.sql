-- SECURITY: stop the anonymous (no-login) harvest of user PII / Stripe / business
-- columns via the public anon key against the world-readable `profiles` table.
--
-- Background: profiles carries a "Public profiles are viewable by everyone" SELECT
-- policy (USING true) AND the anon role held SELECT on all 42 columns. So anyone with
-- the anon key (shipped in the client bundle) could paginate the whole table and read
-- every user's phone, home address, Stripe account id + KYC flags, partner economics,
-- referral graph, and admin role. (Live on 2026-07-14: 46 phones, 38 addresses,
-- 46 Stripe ids, 2 admin accounts.)
--
-- This is a BLOCKLIST stopgap: it revokes the known-sensitive columns from `anon` only.
--   * `authenticated` keeps them so users read their OWN row (checkout / settings / payouts).
--   * Service-role bypasses column grants (checkout / admin / referral flows unaffected).
--   * Every anon-reachable profiles(...) join selects only display columns, so public
--     seller pages + marketplace browse are unaffected.
--
-- The DURABLE fix (whitelist `public_profiles` view + base-table SELECT locked to own row)
-- also closes the residual authenticated cross-user read and the `role`/admin-identity
-- leak. See docs/security/profiles-read-isolation-plan.md. That fix ships WITH the app
-- change that repoints cross-user reads to the view; do not lock the base table before then.

REVOKE SELECT (
  -- PII
  phone_number, address, sub_district, district, state, province, postcode,
  -- Stripe / KYC
  stripe_account_id, stripe_account_status, stripe_charges_enabled,
  stripe_payouts_enabled, stripe_details_submitted, stripe_account_updated_at,
  -- Business / referral / subscription
  partner_fee, total_downloads, referred_by, trade_code, premium_until
) ON public.profiles FROM anon;

NOTIFY pgrst, 'reload schema';
