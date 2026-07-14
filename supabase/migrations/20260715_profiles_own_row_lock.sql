-- FINAL step of the profiles read-isolation fix: lock the base table to own-row
-- SELECT, closing the authenticated cross-user PII harvest (phone / address /
-- Stripe id / referral graph were readable by any signed-in user).
--
-- Applied to prod via the SQL Editor on 2026-07-14 and verified: anon base-table
-- reads went 231 -> 0; the public_profiles view still returns all rows (it is a
-- SECURITY DEFINER view owned by postgres, and profiles is not FORCE ROW LEVEL
-- SECURITY, so the view bypasses this policy); /api/listings + /api/reviews stayed
-- 200 with sellers hydrated from the view.
--
-- ORDERING (fresh environments): this must run only AFTER 20260714_public_profiles_view.sql
-- AND after the app is deployed reading cross-user profile data from public_profiles
-- (see docs/security/profiles-read-isolation-plan.md and lib/publicProfiles.ts). Own-row
-- reads (.eq('id', auth.uid())) and service-role reads are unaffected.

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = id);

NOTIFY pgrst, 'reload schema';
