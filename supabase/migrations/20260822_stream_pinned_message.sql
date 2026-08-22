-- Pinned message: one streamer-authored line every viewer sees for as long as
-- it stays pinned (additive-only; run in the Supabase SQL Editor).
--
-- A COLUMN on streams, not a chat-message flag: chat rows scroll away and can
-- be deleted by moderation, while a pin is stream-level state ("bundle deal
-- today: 5 spots = free shipping") that must survive both. One pin at a time
-- by design — pinning replaces, unpinning clears. Viewers receive changes
-- through the postgres_changes subscription they already hold on streams, so
-- no new channel is needed.

ALTER TABLE public.streams
    ADD COLUMN IF NOT EXISTS pinned_message TEXT
        CHECK (pinned_message IS NULL OR char_length(pinned_message) BETWEEN 1 AND 200),
    ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
