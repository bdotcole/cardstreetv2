-- Live streams open to ALL signed-in viewers (run in the Supabase SQL
-- Editor). RLS twin of lib/betaFeatures.ts GA_FEATURES = ['live_streams']:
-- the app gate now passes every signed-in user, and these policies let
-- Supabase Realtime (postgres_changes respects RLS) actually DELIVER the
-- board/chat/poll updates to them — without this, a GA viewer sees a frozen
-- room that only catches up on refetch.
--
-- Broadcasting stays invite-only: nothing here touches the 'live_broadcast'
-- grant, console routes, or any INSERT/UPDATE path (there are none — all
-- writes remain service-role). The 'live_streams' kill switch in
-- beta_feature_flags still turns the feature off app-wide (the app gate
-- checks it before any of this matters).
--
-- Ballot privacy, win/shipment privacy, and ban visibility are unchanged.

-- Drop + recreate: same policy names, wider audience (any signed-in user).
DROP POLICY IF EXISTS "Beta users can view streams" ON public.streams;
CREATE POLICY "Beta users can view streams" ON public.streams FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Beta users can view stream items" ON public.stream_items;
CREATE POLICY "Beta users can view stream items" ON public.stream_items FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Beta users can view break spots" ON public.break_spots;
CREATE POLICY "Beta users can view break spots" ON public.break_spots FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- The fairness audit is meant to be checkable by the whole room.
DROP POLICY IF EXISTS "Beta users can view randomizations" ON public.break_randomizations;
CREATE POLICY "Beta users can view randomizations" ON public.break_randomizations FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Beta users can view stream chat" ON public.stream_chat_messages;
CREATE POLICY "Beta users can view stream chat" ON public.stream_chat_messages FOR SELECT
    USING (deleted_at IS NULL AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Beta users can view stream polls" ON public.stream_polls;
CREATE POLICY "Beta users can view stream polls" ON public.stream_polls FOR SELECT
    USING (auth.uid() IS NOT NULL);
