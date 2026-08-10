-- Live-breaks presales (additive-only; run in the Supabase SQL Editor).
-- Companion to 20260804_live_breaks.sql / 20260805_live_breaks_hardening.sql.
--
-- Buyers can BUY spots on presale-enabled lots of a SCHEDULED show before it
-- goes live — a real paid purchase through the existing claim -> hold ->
-- checkout flow, not an RSVP. The seller opts each lot in at creation
-- (presale_enabled); everything else about the money path is unchanged.
--
-- App code tolerates the pre-migration state: presale toggles fail soft to
-- non-presale lots and claims on scheduled shows keep returning
-- 'stream_not_live' until this runs.

ALTER TABLE public.stream_items
    ADD COLUMN IF NOT EXISTS presale_enabled BOOLEAN NOT NULL DEFAULT false;

-- ─── claim_break_spot: allow presale claims on scheduled shows ───
-- Identical to the 20260804 body EXCEPT the stream-status guard: a claim now
-- passes when the stream is live OR (scheduled AND the lot has presales
-- open). Every other check (hold steal, lot status, own-item, suspension)
-- is unchanged.

CREATE OR REPLACE FUNCTION public.claim_break_spot(
    p_spot_id UUID,
    p_buyer_id UUID,
    p_hold_seconds INTEGER DEFAULT 180
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sp public.break_spots%ROWTYPE;
    it public.stream_items%ROWTYPE;
    st public.streams%ROWTYPE;
BEGIN
    SELECT * INTO sp FROM public.break_spots WHERE id = p_spot_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'not_found');
    END IF;
    IF sp.status = 'sold' OR sp.status = 'cancelled' THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'unavailable');
    END IF;
    IF sp.status = 'held' AND sp.held_by <> p_buyer_id AND sp.hold_expires_at > NOW() THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'held',
            'hold_expires_at', sp.hold_expires_at);
    END IF;

    SELECT * INTO it FROM public.stream_items WHERE id = sp.stream_item_id;
    IF it.status NOT IN ('queued', 'active') THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'lot_closed');
    END IF;
    SELECT * INTO st FROM public.streams WHERE id = sp.stream_id;
    -- Presales: a scheduled show's presale-enabled lot sells spots before
    -- go-live; anything else still requires the stream to be live.
    IF st.status <> 'live'
       AND NOT (st.status = 'scheduled' AND it.presale_enabled) THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'stream_not_live');
    END IF;
    IF sp.seller_id = p_buyer_id THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'own_item');
    END IF;
    IF public.auction_bidding_suspended(p_buyer_id) THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'suspended');
    END IF;

    UPDATE public.break_spots SET
        status = 'held',
        held_by = p_buyer_id,
        hold_expires_at = NOW() + MAKE_INTERVAL(secs => p_hold_seconds)
    WHERE id = sp.id;

    RETURN jsonb_build_object(
        'claimed', true,
        'spot_id', sp.id,
        'spot_number', sp.spot_number,
        'price', sp.price,
        'hold_expires_at', NOW() + MAKE_INTERVAL(secs => p_hold_seconds)
    );
END;
$$;

-- Re-assert the service-role-only privileges (CREATE OR REPLACE preserves
-- them, but stating them keeps this file self-contained if run standalone).
REVOKE EXECUTE ON FUNCTION public.claim_break_spot(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_break_spot(UUID, UUID, INTEGER) TO service_role;
