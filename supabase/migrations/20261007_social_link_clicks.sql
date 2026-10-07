-- Link clicks per platform, per brand — 2026-10-07.
--
-- social_site_traffic_daily was keyed by day + platform: "how many sessions
-- came from Instagram on this day". The founder wants the tracked short
-- links (cardstreet.app/ig, /ck/ig, ...) counted per platform AND per brand,
-- so the key grows by the utm_campaign (which brand's link) and utm_medium
-- (bio / page / video / story). Existing rows are the old one-row-per-day
-- totals and would double-count beside the split rows, so they are cleared
-- and the next 90-day sync refills the table from GA4.

ALTER TABLE public.social_site_traffic_daily ADD COLUMN IF NOT EXISTS campaign TEXT NOT NULL DEFAULT '';
ALTER TABLE public.social_site_traffic_daily ADD COLUMN IF NOT EXISTS medium TEXT NOT NULL DEFAULT '';
DELETE FROM public.social_site_traffic_daily;
ALTER TABLE public.social_site_traffic_daily DROP CONSTRAINT IF EXISTS social_site_traffic_daily_pkey;
ALTER TABLE public.social_site_traffic_daily ADD PRIMARY KEY (day, platform, campaign, medium);
