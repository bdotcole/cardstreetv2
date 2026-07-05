-- Seller "About" text shown on the public seller profile (SellerProfile
-- About tab). Owner-editable via the /api/profile PATCH route, which caps
-- the length server-side.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
