-- iOS "App Store visit" as a distinct, honestly-labeled download signal.
--
-- Apple exposes no install referrer, so the closest we can measure for an
-- iPhone is: the partner's QR was scanned and we redirected that phone to the
-- App Store. That's intent, not a confirmed install — so it gets its own
-- event_type ('store_visit') rather than masquerading as 'install' (which is
-- reserved for Android's exact, confirmed Play Install Referrer attribution).
--
-- store_visit is deduped per device (a cookie set on first redirect) and
-- increments total_downloads, so partners get credit for driving App Store
-- traffic. If iOS numbers ever look inflated, we add Branch for confirmed iOS
-- installs and demote store_visit to analytics-only.

ALTER TABLE partner_downloads DROP CONSTRAINT IF EXISTS partner_downloads_event_type_check;
ALTER TABLE partner_downloads ADD CONSTRAINT partner_downloads_event_type_check
  CHECK (event_type IN ('click', 'install', 'signup', 'store_visit'));
