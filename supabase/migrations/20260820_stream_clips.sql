-- Clips: breaker-marked highlights of a live break (additive-only; run in the
-- Supabase SQL Editor).
--
-- DESIGN: a clip is a MARKER INTO THE VOD, not a separate video file.
-- start_ms/end_ms are offsets from streams.started_at; playback seeks the VOD
-- and stops at the end. Rationale:
--   * A breaker clips what JUST happened (the pull), which is retrospective —
--     and the room-composite egress is already recording it, so the footage
--     exists the moment they tap.
--   * Cutting real MP4s would mean ffmpeg over a multi-GB file inside a
--     serverless function: slow, timeout-prone and expensive. Same cost
--     instinct as never routing card art through the render endpoint.
--   * Creation is therefore one INSERT — instant, free, and safe to spam
--     mid-break, which is exactly when a breaker has no attention to spare.
-- The trade-off, stated plainly: a clip is NOT watchable until the VOD lands
-- (egress completes minutes after the show ends). Markers are preserved, so
-- rendering standalone files later — via a segmented-HLS egress or a worker —
-- needs no schema or UX change.
--
-- Depends on: streams, stream_items (20260804_live_breaks.sql).

CREATE TABLE IF NOT EXISTS public.stream_clips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Which lot was on the block when it was clipped. Nullable: a breaker can
    -- clip banter or a reveal that is not tied to a lot.
    stream_item_id UUID REFERENCES public.stream_items(id) ON DELETE SET NULL,

    title TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),

    -- Offsets from streams.started_at, in milliseconds.
    start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
    end_ms INTEGER NOT NULL CHECK (end_ms > 0),

    -- Denormalized from streams.vod_url once egress completes, so the share
    -- page is a single-row read and a clip keeps working if the stream row is
    -- later re-pointed.
    vod_url TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT stream_clips_window CHECK (end_ms > start_ms),
    -- Hard ceiling: a "clip" is a highlight, not a re-broadcast. Also bounds
    -- what a share page can stream out of R2 per view.
    CONSTRAINT stream_clips_max_length CHECK (end_ms - start_ms <= 120000)
);

CREATE INDEX IF NOT EXISTS idx_stream_clips_stream
    ON public.stream_clips (stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_clips_creator
    ON public.stream_clips (created_by, created_at DESC);
-- The webhook backfill's lookup: clips still waiting on their VOD.
CREATE INDEX IF NOT EXISTS idx_stream_clips_pending_vod
    ON public.stream_clips (stream_id) WHERE vod_url IS NULL;

ALTER TABLE public.stream_clips ENABLE ROW LEVEL SECURITY;

-- Readable by anyone signed in, matching the GA'd live surfaces
-- (20260819_live_viewers_ga.sql). Clips are promotional by intent — the point
-- is that they get shared.
DROP POLICY IF EXISTS "Signed-in users can view stream clips" ON public.stream_clips;
CREATE POLICY "Signed-in users can view stream clips" ON public.stream_clips FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- No INSERT/UPDATE/DELETE policies by design: every write goes through the
-- service-role API route, which re-checks the broadcaster grant. Same posture
-- as every other live table.
