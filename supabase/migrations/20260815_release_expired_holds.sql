-- Sweep expired break-spot holds back to 'open' (additive-only; run in the
-- Supabase SQL Editor). Companion to 20260804_live_breaks.sql.
--
-- Hold expiry was PASSIVE: claim_break_spot steals a lapsed hold when the
-- next buyer taps that exact spot, but nothing ever flipped the row itself,
-- so a spot abandoned at checkout sat at status='held' with a long-past
-- hold_expires_at forever. Every board that reads the stored status (the
-- "N left" counters, the console tiles) therefore rendered it as reserved and
-- the spot looked unavailable to the whole room. 20260804 already ships the
-- partial index idx_break_spots_expired_holds (hold_expires_at) WHERE
-- status = 'held' — this is the consumer it was built for.
--
-- Callers: the stream-detail GET and the claim route sweep their own stream
-- on every board load (lazy self-heal, no cron). App code fails soft while
-- this migration is unapplied — an un-swept board is exactly today's
-- behaviour, and the client treats a lapsed hold as claimable regardless.

CREATE OR REPLACE FUNCTION public.release_expired_holds(
    p_stream_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    released INTEGER;
BEGIN
    -- SKIP LOCKED: a spot locked right now is one that claim_break_spot or
    -- the checkout path is mid-transaction on. That writer owns the row's
    -- fate; the sweep is opportunistic housekeeping and must never queue
    -- behind it (or, worse, undo a hold it just extended). Anything skipped
    -- is caught by the next board load.
    WITH expired AS (
        SELECT id
        FROM public.break_spots
        WHERE status = 'held'
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at < NOW()
          AND (p_stream_id IS NULL OR stream_id = p_stream_id)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.break_spots AS bs SET
        status = 'open',
        held_by = NULL,
        hold_expires_at = NULL
    FROM expired
    WHERE bs.id = expired.id
      -- LOAD-BEARING: re-assert status = 'held' inside the UPDATE. A spot can
      -- flip to 'sold' between the CTE's snapshot and this write (checkout
      -- extends the hold, then the webhook sells it). Reopening a paid spot
      -- would resell someone's purchase; reopening a house-reserved spot would
      -- silently un-reserve it. 'sold' and 'cancelled' are untouchable here.
      AND bs.status = 'held'
      AND bs.hold_expires_at < NOW();

    GET DIAGNOSTICS released = ROW_COUNT;
    RETURN released;
END;
$$;

-- Service-role only: this is server-side housekeeping invoked by the API
-- routes. A buyer must never be able to clear someone else's live hold.
REVOKE EXECUTE ON FUNCTION public.release_expired_holds(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_holds(UUID) TO service_role;
