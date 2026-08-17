-- "Get notified" opt-in for scheduled shows (additive-only; run in the
-- Supabase SQL Editor). Closes the stream_reminders gap the Whatnot parity
-- spec flagged.
--
-- Why it exists alongside the go-live push blast: the blast only reaches
-- devices with an FCM token (app installs). A web visitor landing on a
-- scheduled show had no way to be told when it starts, and a per-show opt-in
-- is a stronger, more targeted signal than the app-wide announcement — it
-- earns an EMAIL as well as a push.
--
-- One row per (stream, user); the UNIQUE constraint makes the toggle
-- idempotent. notified_at is stamped at go-live so a re-flip (or a future
-- "starting soon" cron) can never notify the same person twice for the same
-- show.

CREATE TABLE IF NOT EXISTS public.stream_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notified_at TIMESTAMPTZ,
    UNIQUE (stream_id, user_id)
);

-- The go-live fan-out reads by stream; the viewer's own state reads by user.
CREATE INDEX IF NOT EXISTS idx_stream_reminders_stream
    ON public.stream_reminders (stream_id) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stream_reminders_user
    ON public.stream_reminders (user_id, created_at DESC);

ALTER TABLE public.stream_reminders ENABLE ROW LEVEL SECURITY;

-- A user sees only their own reminders (the button's on/off state). Writes go
-- through the service-role API route, like every other live table — no
-- INSERT/UPDATE/DELETE policy by design.
DROP POLICY IF EXISTS "Users can view their own stream reminders" ON public.stream_reminders;
CREATE POLICY "Users can view their own stream reminders" ON public.stream_reminders FOR SELECT
    USING (auth.uid() = user_id);
