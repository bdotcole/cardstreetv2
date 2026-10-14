-- Buyer to seller chat.
--
-- The shop page carried a chat button with nothing behind it (hidden
-- 2026-10-14). This is what it opens: one conversation per pair of people, so
-- a seller who later buys from their buyer lands in the same thread rather
-- than a second one.
--
--   chat_threads   one row per pair. buyer_id is whoever wrote first (it only
--                  labels the read/notify columns), seller_id the shop they
--                  wrote to. The pair is unique in either order.
--   chat_messages  the messages.
--
-- Both tables are RLS-on with NO policies: every read and write goes through
-- /api/chat/*, which checks that the caller is in the thread, rate-limits
-- sending, refuses banned accounts and sends the notifications. Nothing here
-- is reachable with the anon or user key.
--
-- Safe to re-run. Until it runs, /api/chat answers "not available" and the app
-- hides the Messages entry points.

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  last_sender_id       UUID,
  buyer_last_read_at   TIMESTAMPTZ,
  seller_last_read_at  TIMESTAMPTZ,
  -- Last EMAIL about this thread to each side; pushes are not throttled.
  buyer_emailed_at     TIMESTAMPTZ,
  seller_emailed_at    TIMESTAMPTZ,
  CONSTRAINT chat_threads_not_self CHECK (buyer_id <> seller_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_pair_uidx
  ON public.chat_threads (LEAST(buyer_id, seller_id), GREATEST(buyer_id, seller_id));
CREATE INDEX IF NOT EXISTS chat_threads_buyer_idx
  ON public.chat_threads (buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS chat_threads_seller_idx
  ON public.chat_threads (seller_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CONSTRAINT chat_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
  ON public.chat_messages (thread_id, created_at DESC);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
