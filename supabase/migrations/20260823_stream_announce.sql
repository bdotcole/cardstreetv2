-- Day-ahead announcement for scheduled PUBLIC shows (additive-only; run in
-- the Supabase SQL Editor). Companion to 20260821_show_prestart_reminder.sql.
--
-- The 2026-08-18 retro: the first real show's go-live blast was the FIRST
-- touch most users ever got — only one organic "Get notified" opt-in existed
-- before the show. The show-reminders cron now also announces upcoming public
-- shows (email + push to the whole base, with a Get-notified CTA) about a day
-- ahead, so the go-live alert lands on a warmed audience.
--
-- Same CAS-claim pattern as prestart_reminder_at: the cron flips this column
-- NULL -> now to win the fan-out, so overlapping runs can never double-send.
-- Shows scheduled less than ~3 hours ahead are never announced (code-side
-- window), which keeps same-day test streams from blasting the user base.

ALTER TABLE public.streams
    ADD COLUMN IF NOT EXISTS announce_sent_at TIMESTAMPTZ;

-- The cron's selection: public scheduled shows not yet announced. Partial, so
-- it stays tiny however many shows accumulate.
CREATE INDEX IF NOT EXISTS idx_streams_announce_pending
    ON public.streams (scheduled_at)
    WHERE status = 'scheduled' AND visibility = 'public' AND announce_sent_at IS NULL;
