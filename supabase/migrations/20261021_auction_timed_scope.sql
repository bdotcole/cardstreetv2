-- Scope the timed-auction lifecycle RPCs to mode = 'timed'.
--
-- Since 20260704_auction_house.sql shipped, live breaks started minting
-- mode = 'live' rows in the same auctions table (app/api/live/lots/[id]/auction/*,
-- closed by their own CAS path in lib/liveBreaks.ts). The every-minute timed
-- sweep (app/api/auctions/sweep) must never touch those: close_due_auctions()
-- would hammer a live lot from under the broadcaster's console, and the settle
-- pass would mint a marketplace order for a stream win. place_bid()/buy_now()
-- are shared by design and stay as they are.
--
-- Also seeds the 'shop_hub' kill-switch row (the mobile Shop section switch,
-- granted per-account) and turns the 'auctions' switch back on: both features
-- are GRANT_ONLY in lib/betaFeatures.ts, so an enabled switch exposes them to
-- explicit profiles.beta_features holders only -- not to admins by role.

CREATE OR REPLACE FUNCTION public.close_due_auctions(p_limit INTEGER DEFAULT 100)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
    v_won BOOLEAN;
BEGIN
    FOR a IN
        SELECT * FROM public.auctions
        WHERE status = 'live' AND mode = 'timed' AND ends_at <= NOW()
        ORDER BY ends_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        IF a.status <> 'live' OR a.mode <> 'timed' OR a.ends_at > NOW() THEN
            CONTINUE;
        END IF;

        v_won := a.high_bidder_id IS NOT NULL
                 AND (a.reserve_price IS NULL OR a.reserve_met);

        IF v_won THEN
            UPDATE public.auctions SET
                status = 'sold',
                winner_id = a.high_bidder_id,
                winning_amount = a.current_price,
                won_via = 'bid',
                closed_at = NOW()
            WHERE id = a.id;
        ELSE
            UPDATE public.auctions SET
                status = 'unsold',
                closed_at = NOW()
            WHERE id = a.id;
        END IF;

        RETURN NEXT jsonb_build_object(
            'auction_id', a.id,
            'seller_id', a.seller_id,
            'sold', v_won,
            'winner_id', CASE WHEN v_won THEN a.high_bidder_id END,
            'winning_amount', CASE WHEN v_won THEN a.current_price END,
            'had_bids', a.bid_count > 0,
            'reserve_not_met', a.high_bidder_id IS NOT NULL AND NOT (a.reserve_price IS NULL OR a.reserve_met)
        );
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_overdue_auction_orders(p_limit INTEGER DEFAULT 50)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
    v_deadbeat UUID;
    v_order UUID;
    v_runner UUID;
    v_runner_max BIGINT;
    v_offered BOOLEAN;
    c RECORD;
BEGIN
    FOR a IN
        SELECT au.* FROM public.auctions au
        JOIN public.orders o ON o.id = au.order_id
        WHERE au.status = 'sold'
          AND au.mode = 'timed'
          AND au.payment_due_at IS NOT NULL
          AND au.payment_due_at <= NOW()
          AND o.status = 'pending_payment'
        ORDER BY au.payment_due_at
        LIMIT p_limit
        FOR UPDATE OF au SKIP LOCKED
    LOOP
        v_deadbeat := a.winner_id;
        v_order := a.order_id;
        v_runner := NULL;
        v_runner_max := NULL;
        v_offered := false;

        -- CAS: only void if the order is still unpaid. A payment that raced
        -- in flips the order off pending_payment first (webhook/finalize).
        UPDATE public.orders
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = v_order AND status = 'pending_payment';
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        INSERT INTO public.auction_strikes (user_id, auction_id, order_id, reason)
        VALUES (v_deadbeat, a.id, v_order, 'unpaid');

        -- Runner-up: best rival max, earliest first on ties, skipping
        -- suspended bidders. Only for first-chance wins via bidding.
        IF a.won_via = 'bid' THEN
            FOR c IN
                SELECT bidder_id, MAX(max_amount) AS best_max, MIN(created_at) AS first_at
                FROM public.bids
                WHERE auction_id = a.id AND bidder_id <> v_deadbeat
                GROUP BY bidder_id
                ORDER BY best_max DESC, first_at ASC
                LIMIT 5
            LOOP
                IF (a.reserve_price IS NULL OR c.best_max >= a.reserve_price)
                   AND NOT public.auction_bidding_suspended(c.bidder_id) THEN
                    v_runner := c.bidder_id;
                    v_runner_max := c.best_max;
                    EXIT;
                END IF;
            END LOOP;
        END IF;

        IF v_runner IS NOT NULL THEN
            UPDATE public.auctions SET
                order_id = NULL,
                payment_due_at = NULL,
                second_chance_offered_to = v_runner,
                second_chance_amount = v_runner_max,
                second_chance_expires_at = NOW() + INTERVAL '48 hours',
                second_chance_status = 'offered'
            WHERE id = a.id;
            v_offered := true;
        ELSE
            UPDATE public.auctions SET
                status = 'unsold',
                order_id = NULL,
                payment_due_at = NULL,
                winner_id = NULL,
                winning_amount = NULL,
                won_via = NULL
            WHERE id = a.id;
        END IF;

        RETURN NEXT jsonb_build_object(
            'auction_id', a.id,
            'seller_id', a.seller_id,
            'deadbeat_id', v_deadbeat,
            'voided_order_id', v_order,
            'second_chance_offered', v_offered,
            'runner_up_id', v_runner,
            'runner_up_amount', v_runner_max
        );
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_second_chance_offers(p_limit INTEGER DEFAULT 50)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
BEGIN
    FOR a IN
        SELECT * FROM public.auctions
        WHERE second_chance_status = 'offered'
          AND mode = 'timed'
          AND second_chance_expires_at <= NOW()
        ORDER BY second_chance_expires_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        IF a.second_chance_status IS DISTINCT FROM 'offered' OR a.second_chance_expires_at > NOW() THEN
            CONTINUE;
        END IF;

        UPDATE public.auctions SET
            status = 'unsold',
            winner_id = NULL,
            winning_amount = NULL,
            won_via = NULL,
            second_chance_status = 'expired'
        WHERE id = a.id;

        RETURN NEXT jsonb_build_object(
            'auction_id', a.id,
            'seller_id', a.seller_id,
            'offered_to', a.second_chance_offered_to
        );
    END LOOP;
END;
$$;

-- Kill-switch rows. 'shop_hub' is new; 'auctions' was switched off at the
-- July teardown and comes back on now that access is grant-only.
INSERT INTO public.beta_feature_flags (feature, enabled)
VALUES ('shop_hub', true)
ON CONFLICT (feature) DO NOTHING;

UPDATE public.beta_feature_flags
SET enabled = true, updated_at = NOW()
WHERE feature = 'auctions';
