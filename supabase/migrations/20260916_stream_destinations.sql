-- Multistream (RTMP simulcast) for live breaks — 2026-09-16.
--
-- The show is pushed to the seller's social channels (Facebook Live, YouTube
-- Live, Instagram Live Producer, TikTok LIVE Studio, Twitch, or any RTMP
-- endpoint) by the SAME LiveKit room-composite egress that already records
-- the VOD: the go-live route adds the destinations as stream outputs, so the
-- social feeds carry the branded overlay (app/live/overlay) pointing viewers
-- back at cardstreet.app/watch.
--
-- stream_destinations — a broadcaster's saved endpoints. The stream key is
-- stored ENCRYPTED (AES-256-GCM, lib/streamKeyCrypto.ts) and is decrypted
-- server-side only at go-live / mid-show add, to hand LiveKit the full URL.
-- key_hint carries the last characters so the console can show which key is
-- saved without ever returning it.
--
-- stream_simulcast_targets — per-show record of which destinations the
-- egress pushed to and how each fared, written by go-live and updated from
-- the LiveKit webhook (egress_updated / egress_ended streamResults) and the
-- console's status poll. url_hash = SHA-256 of the full RTMP URL: results
-- are matched by hash so the key never has to be decrypted (or logged) again.
--
-- RLS ON with NO policies on either table: the service-role API routes are
-- the only readers and writers (the breaker_applications lock). Sellers see
-- their keys' hints, never the keys.

CREATE TABLE IF NOT EXISTS public.stream_destinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    platform TEXT NOT NULL
        CHECK (platform IN ('facebook', 'youtube', 'instagram', 'tiktok', 'twitch', 'custom')),
    label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
    -- Server URL WITHOUT the key, e.g. rtmps://live-api-s.facebook.com:443/rtmp/
    rtmp_url TEXT NOT NULL CHECK (char_length(rtmp_url) BETWEEN 8 AND 500),
    stream_key_enc TEXT NOT NULL,
    key_hint TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_destinations_seller
    ON public.stream_destinations(seller_id, created_at);

CREATE TABLE IF NOT EXISTS public.stream_simulcast_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    destination_id UUID REFERENCES public.stream_destinations(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    label TEXT NOT NULL,
    url_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'starting'
        CHECK (status IN ('starting', 'live', 'ended', 'failed', 'removed')),
    error TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulcast_targets_stream
    ON public.stream_simulcast_targets(stream_id);
-- One row per destination per show: a mid-show stop/start updates the row
-- instead of stacking history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_simulcast_targets_one_per_url
    ON public.stream_simulcast_targets(stream_id, url_hash);

DROP TRIGGER IF EXISTS update_stream_destinations_updated_at ON public.stream_destinations;
CREATE TRIGGER update_stream_destinations_updated_at BEFORE UPDATE ON public.stream_destinations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_stream_simulcast_targets_updated_at ON public.stream_simulcast_targets;
CREATE TRIGGER update_stream_simulcast_targets_updated_at BEFORE UPDATE ON public.stream_simulcast_targets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stream_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_simulcast_targets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose (see header): service role only.
