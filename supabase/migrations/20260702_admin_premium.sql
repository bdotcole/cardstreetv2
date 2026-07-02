-- Admins are Pro by role.
--
-- App-side gates (requirePremium / premium status) now treat role='admin' as
-- entitled; this keeps the SQL predicate -- used by any future RLS on
-- premium-only tables -- in agreement. No data changes: admin entitlement is
-- derived from the role, so new admins are covered automatically and no
-- synthetic subscription rows exist to clean up later.

CREATE OR REPLACE FUNCTION public.is_premium(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND (premium_until > NOW() OR role = 'admin')
  );
$$;
