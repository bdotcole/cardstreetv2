-- Live-breaks audience polls (additive-only; run in the Supabase SQL Editor).
-- Companion to 20260804_live_breaks.sql / 20260810_presales.sql.
--
-- The breaker opens a poll (2-4 options), viewers vote from the live page,
-- tallies update live. Votes are one row per (poll, user) — re-voting moves
-- the vote. After every vote the API recounts votes into stream_polls.tallies
-- with the service role, so Realtime (postgres_changes on stream_polls)
-- pushes live results without exposing individual ballots.
--
-- App code tolerates the pre-migration state: poll routes fail soft (clean
-- errors / empty results) until this runs.

CREATE TABLE IF NOT EXISTS public.stream_polls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
    -- [{"key":"a","label":"..."}, ...] — 2..4 options, validated in the routes.
    options JSONB NOT NULL,
    -- {"a": 12, "b": 3} — full recount written by the vote route after every
    -- upsert; a missing key means zero votes. Last-write recount is
    -- self-correcting: whichever vote lands last recounts everything.
    tallies JSONB NOT NULL DEFAULT '{}',

    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- One vote per user per poll; re-voting updates the row (upsert on this PK).
CREATE TABLE IF NOT EXISTS public.stream_poll_votes (
    poll_id UUID NOT NULL REFERENCES public.stream_polls(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    option_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, user_id)
);

-- One OPEN poll per stream — the create route 409s on this (race-proof).
CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_polls_one_open
    ON public.stream_polls (stream_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_stream_polls_stream
    ON public.stream_polls (stream_id, created_at DESC);

-- ─── RLS ───

ALTER TABLE public.stream_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_poll_votes ENABLE ROW LEVEL SECURITY;

-- Same beta gate as stream_chat_messages, plus the seller's own rows — the
-- console may hold only the 'live_broadcast' grant and still needs its
-- Realtime tally updates delivered under RLS.
CREATE POLICY "Beta users can view stream polls" ON public.stream_polls FOR SELECT
    USING (
        seller_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                   AND ('live_streams' = ANY(p.beta_features) OR p.role = 'admin'))
    );
-- Ballots are private: a user sees only their own vote row (the "your pick"
-- highlight); aggregate results ride stream_polls.tallies.
CREATE POLICY "Users can view their own poll votes" ON public.stream_poll_votes FOR SELECT
    USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies: writes go through service-role routes
-- (requireBeta + rate limits first), same as every other live table.

-- ─── Realtime (postgres_changes respects RLS — dark on the wire) ───
-- Only stream_polls is published: the tallies recount is the live signal;
-- individual vote rows never leave the DB.

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stream_polls;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
