-- Public (logged-out) live viewing (run in the Supabase SQL Editor).
-- Supersedes the audience half of 20260819_live_viewers_ga.sql, which opened
-- these tables to any SIGNED-IN user; a shared show link still dead-ended at a
-- sign-in wall for everyone else, which is exactly the audience a share is
-- aimed at.
--
-- Realtime (postgres_changes) applies RLS to the ANON key too, so without
-- these an anonymous viewer would load the page and then watch a frozen board
-- and a chat that never moves. The API reads are service-role and would have
-- worked either way — this is what makes the room LIVE for them.
--
-- SELECT only, and only the tables an audience needs to watch. Every write
-- still goes through a service-role API route behind an auth gate: buying,
-- bidding, chatting, reacting, voting and reminders are all unchanged and
-- still require an account. There are (still) no INSERT/UPDATE/DELETE
-- policies on any of these tables.
--
-- Exposure note: these rows are the public face of a show — title, seller,
-- lots, prices, spot board (buyer_id is deliberate social proof, and NAMES
-- resolve through the public_profiles view, which already grants anon), chat
-- and polls. streams also carries livekit_egress_id / vod_url; both are
-- inert handles (vod_url is never populated — the egress webhook is still a
-- TODO) and the API's viewer projection omits them regardless.

DROP POLICY IF EXISTS "Beta users can view streams" ON public.streams;
CREATE POLICY "Anyone can view streams" ON public.streams FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Beta users can view stream items" ON public.stream_items;
CREATE POLICY "Anyone can view stream items" ON public.stream_items FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Beta users can view break spots" ON public.break_spots;
CREATE POLICY "Anyone can view break spots" ON public.break_spots FOR SELECT
    USING (true);

-- The fairness audit is meant to be checkable by the whole room, signed in or not.
DROP POLICY IF EXISTS "Beta users can view randomizations" ON public.break_randomizations;
CREATE POLICY "Anyone can view randomizations" ON public.break_randomizations FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Beta users can view stream chat" ON public.stream_chat_messages;
CREATE POLICY "Anyone can view stream chat" ON public.stream_chat_messages FOR SELECT
    USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "Beta users can view stream polls" ON public.stream_polls;
CREATE POLICY "Anyone can view stream polls" ON public.stream_polls FOR SELECT
    USING (true);

-- Unchanged and deliberately NOT public: stream_poll_votes (a ballot is
-- private to its voter), stream_reminders (own rows only), stream_wins and
-- shipments (buyer/seller only), stream_chat_bans.
