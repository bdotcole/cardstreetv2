-- Android Play Install Referrer confirmations (event_type 'install').
--
-- /api/referrals/install logs one 'install' event per Android device and
-- bumps the partner's total_downloads. The device identifies itself with a
-- client-persisted UUID (install_id) minted before its first post, so
-- network-failure retries reuse the same id — the partial unique index makes
-- the dedupe atomic even under concurrent retries (the endpoint maps the
-- 23505 to { counted: false, reason: 'duplicate' }).
--
-- Both objects already exist in the live DB (added ad hoc when the event
-- columns landed); this migration records them for fresh environments and is
-- a no-op against production — names and predicates match live exactly.
--
-- 'install' has been in the event_type CHECK since 20260611 (reserved for
-- exactly this integration), so no constraint change is needed.

ALTER TABLE partner_downloads
  ADD COLUMN IF NOT EXISTS install_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_partner_downloads_install_id
  ON partner_downloads(install_id)
  WHERE event_type = 'install' AND install_id IS NOT NULL;
