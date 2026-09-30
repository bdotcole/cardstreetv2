-- Scheduled announcement campaign — 2026-09-30.
--
-- The Oct 9 "shipping inside the listing price" change is announced with four
-- emails to every user and two pushes to sellers with listings. There was no
-- broadcast sender in the app, so /api/cron/launch-campaign now sends them on
-- a schedule (lib/launchCampaign.ts holds the copy and the audiences).
--
-- campaign_messages — the schedule. One row per message. The cron sends a
-- message once send_at has passed and held is false, then stamps
-- completed_at. To move a send, UPDATE send_at; to stop one, set held = true.
-- The go-live email starts held: it says the change is live, so it is released
-- by hand in the same SQL block that raises the prices.
--
-- campaign_sends — who has been sent what. The primary key is the guarantee
-- that nobody gets the same message twice: the cron claims a row before it
-- sends and removes the claim if the send fails. kind = 'preview' rows are the
-- copies sent to admins ahead of the real send.
--
-- RLS ON with NO policies on either table: the service-role cron is the only
-- reader and writer.

CREATE TABLE IF NOT EXISTS public.campaign_messages (
    key TEXT PRIMARY KEY,
    send_at TIMESTAMPTZ NOT NULL,
    held BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.campaign_sends (
    message_key TEXT NOT NULL REFERENCES public.campaign_messages(key) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    kind TEXT NOT NULL DEFAULT 'send' CHECK (kind IN ('send', 'preview')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_key, user_id, kind)
);

ALTER TABLE public.campaign_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_sends ENABLE ROW LEVEL SECURITY;

-- Bangkok time (+07). Pushes go at 18:00 rather than midnight so they are
-- seen; the go-live email waits for the release at go-live.
INSERT INTO public.campaign_messages (key, send_at, held) VALUES
    ('shipping-email-1', '2026-10-01 14:00:00+07', false),
    ('shipping-email-2', '2026-10-05 10:00:00+07', false),
    ('shipping-push-1',  '2026-10-06 18:00:00+07', false),
    ('shipping-email-3', '2026-10-08 00:00:00+07', false),
    ('shipping-push-2',  '2026-10-08 18:00:00+07', false),
    ('shipping-email-4', '2026-10-09 00:00:00+07', true)
ON CONFLICT (key) DO NOTHING;
