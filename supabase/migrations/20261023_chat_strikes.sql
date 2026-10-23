-- Chat strike ladder (2026-10-23).
--
-- A message the chat policy refuses (lib/chatPolicy.ts: contact details, an
-- outside link, an off-app deal, or selling cards that are not listed) is a
-- strike, kept here for review. Lifetime strikes per user set
-- profiles.chat_banned_until (lib/chatModeration.server.ts):
--
--   1   warning (the refusal itself says what comes next)
--   2   chat suspended 48 hours
--   3   chat suspended 7 days
--   4+  chat disabled for good ('infinity')
--
-- The ladder lives in lib/chat.ts:chatBanForStrike; this file only stores.
-- Service-role only: RLS on with no policies. Safe to re-run. Until it runs
-- the policy still refuses the message, but no strike is kept and no ban
-- applied.
--
-- To lift a ban by hand:
--   UPDATE public.profiles SET chat_banned_until = NULL WHERE id = '<uuid>';
--   DELETE FROM public.chat_strikes WHERE user_id = '<uuid>';  -- resets the ladder

CREATE TABLE IF NOT EXISTS public.chat_strikes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  -- The refused message, so a ban can be reviewed. Nobody else ever saw it.
  body       TEXT NOT NULL,
  -- The conversation it was typed into, when the sender named one.
  thread_id  UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_strikes_user_idx
  ON public.chat_strikes (user_id, created_at DESC);

ALTER TABLE public.chat_strikes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS chat_banned_until TIMESTAMPTZ;
COMMENT ON COLUMN public.profiles.chat_banned_until IS
  'Chat suspended until this instant (infinity = for good). NULL or past: may chat.';
