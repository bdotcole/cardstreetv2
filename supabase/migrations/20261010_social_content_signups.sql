-- Social dashboard, round three (2026-10-10): sign-ups per link, per-post
-- content metrics, and the weekly insights email.
--
-- 1. social_site_traffic_daily.signups — GA4 sign_up events by the user's
--    FIRST-touch source/medium/campaign (user-scoped), stored beside the
--    session-scoped clicks so the Tracked links card can show "21 clicks,
--    2 sign-ups" per link. Upserted on its own; sessions/users default to 0
--    on a row that only ever saw a sign-up.
--
-- 2. profiles.acquisition_* — the exact, cross-session answer: the utm set a
--    person first landed with (web) or installed from (Play install
--    referrer), written once at sign-up by /api/profile/acquisition. This is
--    what lets later questions ("did Instagram sign-ups go on to buy?") be
--    answered from our own data instead of GA4's modelled attribution.
--
-- 3. social_posts content columns — what each platform's API says about a
--    post's performance beyond likes/comments: format (reel / short / photo /
--    carousel / video / live), length, watch time, average watch time and %,
--    hook (YouTube: % of viewers still watching at 30s, from the retention
--    curve kept in `retention`), follows and profile visits the post drove,
--    Instagram's total_interactions. All nullable — platforms differ, and a
--    refused metric stays null rather than becoming a fake zero.
--
-- 4. social_insight_reports — one weekly "what worked / what to try" report
--    per brand per week: the computed stats, the narrative, the rendered
--    email and where it went. The cron is idempotent on (brand, week_start)
--    and the dashboard lists past reports.
--
-- RLS ON, no policies (service-role only), like the rest of the social tables.

ALTER TABLE public.social_site_traffic_daily
    ADD COLUMN IF NOT EXISTS signups INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS acquisition_source TEXT,
    ADD COLUMN IF NOT EXISTS acquisition_medium TEXT,
    ADD COLUMN IF NOT EXISTS acquisition_campaign TEXT,
    ADD COLUMN IF NOT EXISTS acquisition_landed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_acquisition_source
    ON public.profiles(acquisition_source, created_at)
    WHERE acquisition_source IS NOT NULL;

ALTER TABLE public.social_posts
    ADD COLUMN IF NOT EXISTS format TEXT,
    ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
    ADD COLUMN IF NOT EXISTS watch_time_seconds BIGINT,
    ADD COLUMN IF NOT EXISTS avg_watch_seconds NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS avg_watch_pct NUMERIC(6, 2),
    ADD COLUMN IF NOT EXISTS hook_pct NUMERIC(6, 2),
    ADD COLUMN IF NOT EXISTS follows INTEGER,
    ADD COLUMN IF NOT EXISTS profile_visits INTEGER,
    ADD COLUMN IF NOT EXISTS total_interactions INTEGER,
    ADD COLUMN IF NOT EXISTS retention JSONB;

CREATE TABLE IF NOT EXISTS public.social_insight_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand TEXT NOT NULL CHECK (brand IN ('cardstreet', 'chopper_kuma')),
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    sent_to TEXT,
    sent_at TIMESTAMPTZ,
    stats JSONB NOT NULL,
    narrative JSONB,
    html TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand, week_start)
);

ALTER TABLE public.social_insight_reports ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service role only.
