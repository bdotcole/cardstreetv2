-- Social media dashboard (Admin -> Social) — 2026-10-05.
--
-- Daily reach / followers / views / link-click snapshots for the brand social
-- accounts (Cardstreet and the Chopper & Kuma pet channel), pulled straight
-- from each platform's own free API by the daily cron
-- (app/api/cron/social-metrics) and shown in app/admin/social. No third-party
-- analytics vendor: Metricool's free tier holds one brand with 30 days of
-- history; this keeps every day we ever pulled, for both brands, at no cost.
--
-- social_accounts — one row per connected Facebook Page / Instagram
-- professional account / YouTube channel / TikTok account. OAuth tokens are
-- stored ENCRYPTED (AES-256-GCM, lib/social/tokenCrypto.ts) and decrypted
-- server-side only when the sync runs. An admin connects accounts through
-- app/api/admin/social/connect/<platform>; a connect that finds several
-- accounts (one Facebook login often admins both brands' Pages) files them
-- all under the chosen brand, and the dashboard lets an admin move a row to
-- the other brand afterwards.
--
-- social_metrics_daily — one row per account per day. Platforms differ in
-- what they expose, so most columns are nullable: TikTok's public API has no
-- reach or profile views; YouTube has no link clicks. `raw` keeps the
-- platform's own response so a metric we did not map can be recovered later
-- without re-pulling (Instagram only serves 90 days back).
--
-- social_posts — the recent posts per account with their engagement, for the
-- "top content" list. Refreshed on every sync (counts keep moving for weeks).
--
-- social_site_traffic_daily — sessions on cardstreet.app that arrived from
-- each social platform, from GA4. This is the link-click number that matters
-- for Cardstreet (the platforms' own "link taps" are patchy: Instagram counts
-- profile-link taps only, TikTok reports nothing), keyed by platform rather
-- than account because GA4 only knows the referrer.
--
-- RLS ON with NO policies on every table: the service-role admin routes and
-- the cron are the only readers and writers (the stream_destinations lock).

CREATE TABLE IF NOT EXISTS public.social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand TEXT NOT NULL CHECK (brand IN ('cardstreet', 'chopper_kuma')),
    platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'youtube', 'tiktok')),
    -- Page id / IG user id / channel id / TikTok open_id.
    external_id TEXT NOT NULL,
    handle TEXT,
    display_name TEXT,
    avatar_url TEXT,
    profile_url TEXT,
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at TIMESTAMPTZ,
    token_scopes TEXT[],
    -- Instagram accounts are reached through their parent Facebook Page's
    -- token; the parent row is kept so a Page disconnect also drops the IG row.
    parent_account_id UUID REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    connected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    last_sync_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_brand
    ON public.social_accounts(brand, platform);

CREATE TABLE IF NOT EXISTS public.social_metrics_daily (
    account_id UUID NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    -- End-of-day follower / subscriber total, and the net change that day.
    followers INTEGER,
    follower_delta INTEGER,
    -- Unique accounts that saw any content that day (Facebook, Instagram).
    reach INTEGER,
    -- Content views / plays that day (all four platforms).
    views INTEGER,
    profile_views INTEGER,
    -- Taps on the profile link / CTA buttons (Facebook, Instagram).
    link_clicks INTEGER,
    -- Likes + comments + shares + saves (platform-defined total where one exists).
    engagements INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    saves INTEGER,
    -- YouTube only.
    watch_minutes INTEGER,
    posts INTEGER,
    raw JSONB,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, day)
);

CREATE INDEX IF NOT EXISTS idx_social_metrics_daily_day
    ON public.social_metrics_daily(day);

CREATE TABLE IF NOT EXISTS public.social_posts (
    account_id UUID NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    caption TEXT,
    media_type TEXT,
    permalink TEXT,
    thumbnail_url TEXT,
    reach INTEGER,
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    saves INTEGER,
    raw JSONB,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_published
    ON public.social_posts(account_id, published_at DESC);

CREATE TABLE IF NOT EXISTS public.social_site_traffic_daily (
    day DATE NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'youtube', 'tiktok')),
    sessions INTEGER NOT NULL DEFAULT 0,
    users INTEGER NOT NULL DEFAULT 0,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (day, platform)
);

DROP TRIGGER IF EXISTS update_social_accounts_updated_at ON public.social_accounts;
CREATE TRIGGER update_social_accounts_updated_at BEFORE UPDATE ON public.social_accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_site_traffic_daily ENABLE ROW LEVEL SECURITY;
-- No policies on purpose (see header): service role only.
