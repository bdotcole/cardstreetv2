-- "Starts in 15 minutes" heads-up for Get-notified subscribers (additive-only;
-- run in the Supabase SQL Editor). Companion to 20260820_stream_reminders.sql.
--
-- The claim lives on the SHOW, not on each reminder row: the cron CASes this
-- column to win the right to fan out, so two overlapping runs can never
-- double-send, and a subscriber who opts in after the sweep simply catches the
-- go-live alert instead. It is deliberately NOT stream_reminders.notified_at —
-- that one marks the go-live send, and a subscriber should get BOTH the
-- heads-up and the it's-live-now alert.

ALTER TABLE public.streams
    ADD COLUMN IF NOT EXISTS prestart_reminder_at TIMESTAMPTZ;

-- The cron's selection: upcoming shows inside the reminder window that haven't
-- been claimed yet. Partial, so it stays tiny however many shows accumulate.
CREATE INDEX IF NOT EXISTS idx_streams_prestart_pending
    ON public.streams (scheduled_at)
    WHERE status = 'scheduled' AND prestart_reminder_at IS NULL;
