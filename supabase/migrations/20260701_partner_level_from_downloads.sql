-- Auto-promote partner tier from attributed app downloads.
--
-- Until now profiles.partner_level (the fee tier, 1-9) was set only by admins;
-- total_downloads grew via increment_partner_downloads() but never moved the
-- level or the fee. This closes the loyalty loop the partner program describes:
--   total_downloads  ->  partner_level  ->  partner_fee (and the checkout fee).
--
-- Thresholds + fees MUST match lib/partnerTiers.ts (PARTNER_TIERS). If you change
-- one, change the other.

-- Level a partner qualifies for at a given download count (1-9).
CREATE OR REPLACE FUNCTION partner_level_for_downloads(p_downloads INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_downloads, 0) >= 10000 THEN 9
    WHEN coalesce(p_downloads, 0) >= 7500  THEN 8
    WHEN coalesce(p_downloads, 0) >= 5000  THEN 7
    WHEN coalesce(p_downloads, 0) >= 3500  THEN 6
    WHEN coalesce(p_downloads, 0) >= 2500  THEN 5
    WHEN coalesce(p_downloads, 0) >= 1000  THEN 4
    WHEN coalesce(p_downloads, 0) >= 500   THEN 3
    WHEN coalesce(p_downloads, 0) >= 100   THEN 2
    ELSE 1
  END;
$$;

-- Seller fee (percent; matches profiles.partner_fee DECIMAL(5,3)) for a level.
CREATE OR REPLACE FUNCTION partner_fee_for_level(p_level INTEGER)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE least(greatest(coalesce(p_level, 1), 1), 9)
    WHEN 1 THEN 5.0
    WHEN 2 THEN 4.5
    WHEN 3 THEN 4.0
    WHEN 4 THEN 3.5
    WHEN 5 THEN 3.0
    WHEN 6 THEN 2.75
    WHEN 7 THEN 2.5
    WHEN 8 THEN 2.25
    WHEN 9 THEN 2.0
  END;
$$;

-- Keep partner_level + partner_fee in sync on every partner profile write.
-- Downloads auto-promote; an admin-granted level acts as a floor; nobody is
-- demoted below what their downloads have earned (GREATEST). Non-partner rows
-- (partner_joined_at IS NULL) are left untouched.
CREATE OR REPLACE FUNCTION sync_partner_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.partner_joined_at IS NOT NULL THEN
    NEW.partner_level := GREATEST(
      coalesce(NEW.partner_level, 1),
      partner_level_for_downloads(NEW.total_downloads)
    );
    NEW.partner_fee := partner_fee_for_level(NEW.partner_level);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_partner_tier ON profiles;
CREATE TRIGGER trg_sync_partner_tier
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_partner_tier();

-- One-time backfill: promote existing partners to the level their current
-- downloads have already earned, and set the matching fee. Idempotent; the
-- trigger keeps them in sync from here on.
UPDATE profiles
SET partner_level = GREATEST(coalesce(partner_level, 1), partner_level_for_downloads(total_downloads)),
    partner_fee   = partner_fee_for_level(GREATEST(coalesce(partner_level, 1), partner_level_for_downloads(total_downloads)))
WHERE partner_joined_at IS NOT NULL;
