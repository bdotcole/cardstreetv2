-- Referral tracking for partner QR codes / links.
--
-- Builds on the dormant columns from 20260309_admin_schema.sql:
--   profiles.partner_qr_slug   (unique, was never populated)
--   partner_downloads          (event table, was never written to)
--
-- Event model:
--   'click'   — someone opened cardstreet.app/join/<slug>. Analytics only;
--               does NOT increment total_downloads (trivially gameable).
--   'signup'  — a new account was attributed to the partner (cs_ref cookie or
--               ?ref= param). Increments total_downloads — this is the tier
--               metric, measurable on every platform.
--   'install' — reserved for a future Android Install Referrer integration;
--               the column default keeps any legacy rows counting as installs.

-- 1. Event type + attributed user on the events table
ALTER TABLE partner_downloads
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'install'
    CHECK (event_type IN ('click', 'install', 'signup')),
  ADD COLUMN IF NOT EXISTS referred_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_downloads_partner_event
  ON partner_downloads(partner_id, event_type);

-- 2. Who referred this user (set once at signup attribution; also the
--    prerequisite for the advertised diamond/black-opal profit sharing).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 3. Backfill slugs for existing partners. Name-derived prefix (ASCII only —
--    Thai names fall back to 'partner') + 4 random hex chars for uniqueness.
UPDATE profiles
SET partner_qr_slug =
  coalesce(
    nullif(btrim(left(lower(regexp_replace(coalesce(display_name, ''), '[^a-zA-Z0-9]+', '-', 'g')), 20), '-'), ''),
    'partner'
  ) || '-' || substr(md5(gen_random_uuid()::text), 1, 4)
WHERE partner_joined_at IS NOT NULL
  AND partner_qr_slug IS NULL;

-- 4. Atomic counter bump (supabase-js can't do column = column + 1 without an
--    RPC). SECURITY DEFINER is not needed — only service-role callers use it.
CREATE OR REPLACE FUNCTION increment_partner_downloads(p_partner_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE profiles
  SET total_downloads = coalesce(total_downloads, 0) + 1
  WHERE id = p_partner_id;
$$;
