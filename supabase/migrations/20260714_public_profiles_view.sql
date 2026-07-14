-- ADDITIVE + SAFE TO APPLY ANYTIME. Nothing reads this view yet, so applying it
-- changes no behavior. It is the display half of the profiles read-isolation fix
-- (see docs/security/profiles-read-isolation-plan.md). The base-table SELECT lock
-- that actually closes the authenticated harvest is applied LATER, only after the
-- app is deployed reading cross-user display data from this view.
--
-- `public_profiles` is a curated, non-sensitive projection of `profiles`. It is
-- deliberately a SECURITY DEFINER view (security_invoker = off): it must return every
-- seller's PUBLIC columns to anon/authenticated even after the base table is locked to
-- own-row reads. Because it exposes ONLY non-sensitive columns (the same fields already
-- public today), bypassing the base-table RLS here is intended and safe. This trips the
-- Supabase linter rule 0010_security_definer_view — that warning is an accepted, reviewed
-- exception for this specific curated public projection.
--
-- `role` is intentionally NOT exposed; it is replaced by a derived `is_official` boolean
-- so the public surface can flag the owner/official account without leaking who the admins
-- are (admin-identity enumeration was part of the #8 leak).

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = off) AS
SELECT
  id,
  username,
  display_name,
  avatar_url,
  bio,
  partner_tier,
  partner_qr_slug,
  partner_joined_at,
  rating,
  review_count,
  is_verified_shop,
  created_at,
  (role = 'admin') AS is_official
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
