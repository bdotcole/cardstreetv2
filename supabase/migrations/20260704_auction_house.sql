-- Auction house (beta, dark-shipped): auctions + bids + auction_strikes.
--
-- Design notes:
--   * All auction money is INTEGER SATANG (BIGINT). The bid engine does exact
--     integer math; THB conversion happens only at display / order creation.
--     TS single source: lib/auctionRules.ts. auction_bid_increment() below is
--     its SQL mirror -- change BOTH together (partnerTiers discipline).
--   * The listings table is untouched: auctions are their own entity carrying
--     the same card_data JSONB snapshot convention. At settlement the Node
--     side creates a synthetic listings row born status='sold' purely so the
--     existing order/fulfillment rail works unchanged.
--   * ALL bid logic lives in place_bid(): SELECT ... FOR UPDATE on the auction
--     row, increment validation, eBay proxy resolution, soft-close extension.
--     Clients never compute price. The RPCs are SECURITY DEFINER with EXECUTE
--     revoked from anon/authenticated (bump_rate_limit pattern): callable only
--     through the beta-gated API routes, which is what makes the p_*_id
--     parameters trustworthy.
--   * Max bids are secret. They live ONLY on bids.max_amount, and bids RLS
--     lets a user read just their own rows. Public bid history is served by
--     the API with max_amount stripped. The auctions row (public, realtime)
--     never carries a max.
--   * mode + per-row soft-close columns are the reusability seam for live
--     breaking: 'live' = same RPC with short timers, no schema change.

-- ─── Tables ───

CREATE TABLE IF NOT EXISTS public.auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- Card snapshot (same convention as listings; sealed pc-* ids ride along)
    card_id TEXT NOT NULL,
    card_data JSONB NOT NULL,
    condition TEXT NOT NULL CHECK (condition IN
        ('Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged', 'Sealed')),
    is_graded BOOLEAN NOT NULL DEFAULT false,
    grading_company TEXT CHECK (grading_company IN ('PSA', 'BGS', 'CGC', 'ARS') OR grading_company IS NULL),
    grade DECIMAL(3,1) CHECK (grade >= 1.0 AND grade <= 10.0 OR grade IS NULL),
    -- Seller-shot photos, same requirement as fixed-price listings.
    image_front_url TEXT,
    image_back_url TEXT,

    -- Pricing (satang)
    starting_price BIGINT NOT NULL CHECK (starting_price >= 100),
    reserve_price BIGINT CHECK (reserve_price IS NULL OR reserve_price >= starting_price),
    buy_now_price BIGINT CHECK (buy_now_price IS NULL OR buy_now_price >= starting_price),
    current_price BIGINT NOT NULL,
    reserve_met BOOLEAN NOT NULL DEFAULT false,

    -- Bid state
    bid_count INTEGER NOT NULL DEFAULT 0,
    high_bidder_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    high_bid_id UUID, -- FK added after bids exists

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'sold', 'unsold', 'cancelled')),
    ends_at TIMESTAMPTZ NOT NULL,
    original_ends_at TIMESTAMPTZ NOT NULL,
    extension_count INTEGER NOT NULL DEFAULT 0,
    closed_at TIMESTAMPTZ,

    -- Engine config (defaults mirror lib/auctionRules.ts; 'live' mode later
    -- runs the same RPC with short timers)
    mode TEXT NOT NULL DEFAULT 'timed' CHECK (mode IN ('timed', 'live')),
    soft_close_window_seconds INTEGER NOT NULL DEFAULT 120,
    soft_close_extension_seconds INTEGER NOT NULL DEFAULT 120,

    -- Outcome + payment
    winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    winning_amount BIGINT,
    won_via TEXT CHECK (won_via IN ('bid', 'buy_now', 'second_chance') OR won_via IS NULL),
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    payment_due_at TIMESTAMPTZ,

    -- Second-chance offer to the runner-up after a deadbeat void
    second_chance_offered_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    second_chance_amount BIGINT,
    second_chance_expires_at TIMESTAMPTZ,
    second_chance_status TEXT CHECK (second_chance_status IN
        ('offered', 'accepted', 'declined', 'expired') OR second_chance_status IS NULL),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Monotonic within-transaction ordering for bid history (created_at ties).
    seq BIGSERIAL,
    auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
    bidder_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- The visible bid amount at this event (satang).
    amount BIGINT NOT NULL CHECK (amount > 0),
    -- The bidder's proxy ceiling at this event. SECRET: RLS exposes a bids row
    -- only to its own bidder; public history is API-served with this stripped.
    max_amount BIGINT NOT NULL CHECK (max_amount >= amount),
    -- true = system-generated counter-bid on behalf of the standing high
    -- bidder during proxy resolution (not a user action).
    is_proxy BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.auctions
    ADD CONSTRAINT auctions_high_bid_id_fkey
    FOREIGN KEY (high_bid_id) REFERENCES public.bids(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.auction_strikes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    auction_id UUID REFERENCES public.auctions(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT 'unpaid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ───

CREATE INDEX IF NOT EXISTS idx_auctions_status_ends_at ON public.auctions (status, ends_at);
CREATE INDEX IF NOT EXISTS idx_auctions_live_ends_at ON public.auctions (ends_at) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_auctions_seller ON public.auctions (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auctions_winner ON public.auctions (winner_id) WHERE winner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bids_auction_seq ON public.bids (auction_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON public.bids (bidder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_strikes_user ON public.auction_strikes (user_id, created_at DESC);

-- ─── updated_at trigger (shared helper from 20260518) ───

DROP TRIGGER IF EXISTS update_auctions_updated_at ON public.auctions;
CREATE TRIGGER update_auctions_updated_at
    BEFORE UPDATE ON public.auctions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── RLS ───

ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_strikes ENABLE ROW LEVEL SECURITY;

-- Auctions are readable only inside the beta (grant or admin role): keeps the
-- feature genuinely dark against direct PostgREST reads, and lets Supabase
-- Realtime (postgres_changes respects RLS) stream price updates to beta users.
-- No INSERT/UPDATE/DELETE policies: writes go through service-role routes/RPCs.
CREATE POLICY "Beta users can view auctions"
    ON public.auctions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND ('auctions' = ANY(p.beta_features) OR p.role = 'admin')
    ));

-- A bids row is visible ONLY to its own bidder (max_amount is on the row and
-- must stay secret from rivals and the seller alike).
CREATE POLICY "Bidders can view their own bids"
    ON public.bids FOR SELECT
    USING (auth.uid() = bidder_id);

CREATE POLICY "Users can view their own strikes"
    ON public.auction_strikes FOR SELECT
    USING (auth.uid() = user_id);

-- ─── Realtime ───
-- The auctions row is the live-update channel (current_price / ends_at /
-- bid_count); duplicate-add is a no-op error we swallow for idempotent reruns.

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- ─── Rules mirrors (single TS source: lib/auctionRules.ts) ───

-- Bid increment ladder. Satang in, satang out.
CREATE OR REPLACE FUNCTION public.auction_bid_increment(p_price BIGINT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_price <   10000 THEN   500  -- < ฿100        → ฿5
        WHEN p_price <   50000 THEN  1000  -- ฿100–499      → ฿10
        WHEN p_price <  100000 THEN  2000  -- ฿500–999      → ฿20
        WHEN p_price <  500000 THEN  5000  -- ฿1,000–4,999  → ฿50
        WHEN p_price < 1000000 THEN 10000  -- ฿5,000–9,999  → ฿100
        WHEN p_price < 5000000 THEN 25000  -- ฿10,000–49,999→ ฿250
        ELSE 50000                         -- ≥ ฿50,000     → ฿500
    END;
$$;

-- Deadbeat suspension: STRIKE_LIMIT (2) strikes inside STRIKE_WINDOW_DAYS (90).
CREATE OR REPLACE FUNCTION public.auction_bidding_suspended(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*) >= 2
    FROM public.auction_strikes
    WHERE user_id = p_user_id
      AND created_at > NOW() - INTERVAL '90 days';
$$;

-- ─── place_bid: the whole ballgame ───
--
-- eBay proxy model: the bidder submits a MAX; the system bids the minimum
-- needed on their behalf. Resolution against the incumbent's max happens here,
-- atomically, under the auction row lock. Ties go to the earlier bidder.
-- Reserve: the displayed price jumps to the reserve as soon as a max covers it.
-- Soft close: any accepted bid inside the final window pushes ends_at out.
--
-- Returns jsonb:
--   { accepted, reason, auction_id, current_price, min_next_bid,
--     is_high_bidder, high_bidder_id, your_max, ends_at, extended,
--     bid_count, reserve_met }

CREATE OR REPLACE FUNCTION public.place_bid(
    p_auction_id UUID,
    p_bidder_id UUID,
    p_max_bid BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
    v_high_max BIGINT;
    v_min_next BIGINT;
    v_new_price BIGINT;
    v_new_bid_id UUID;
    v_is_high BOOLEAN := false;
    v_extended BOOLEAN := false;
    v_rows_added INTEGER := 0;
BEGIN
    SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'not_found');
    END IF;
    IF a.status <> 'live' OR NOW() >= a.ends_at THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'ended',
            'current_price', a.current_price, 'bid_count', a.bid_count);
    END IF;
    IF a.seller_id = p_bidder_id THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'own_auction');
    END IF;
    IF public.auction_bidding_suspended(p_bidder_id) THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'suspended');
    END IF;
    IF p_max_bid IS NULL OR p_max_bid <= 0 OR p_max_bid > 1000000000 THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'invalid_amount');
    END IF;

    -- Incumbent's secret ceiling, if any.
    IF a.high_bid_id IS NOT NULL THEN
        SELECT max_amount INTO v_high_max FROM public.bids WHERE id = a.high_bid_id;
    END IF;

    IF a.high_bidder_id IS NOT NULL AND a.high_bidder_id = p_bidder_id THEN
        -- ── Raise own max. Price only moves if the raise newly covers the reserve. ──
        IF p_max_bid <= COALESCE(v_high_max, 0) THEN
            RETURN jsonb_build_object('accepted', false, 'reason', 'not_above_own_max',
                'your_max', v_high_max, 'current_price', a.current_price);
        END IF;

        v_new_price := a.current_price;
        IF a.reserve_price IS NOT NULL AND NOT a.reserve_met AND p_max_bid >= a.reserve_price THEN
            v_new_price := a.reserve_price;
        END IF;

        INSERT INTO public.bids (auction_id, bidder_id, amount, max_amount, is_proxy)
        VALUES (a.id, p_bidder_id, v_new_price, p_max_bid, false)
        RETURNING id INTO v_new_bid_id;
        v_rows_added := 1;
        v_is_high := true;

    ELSIF a.high_bid_id IS NULL THEN
        -- ── First bid: displays at the starting price (or jumps to a covered reserve). ──
        IF p_max_bid < a.starting_price THEN
            RETURN jsonb_build_object('accepted', false, 'reason', 'below_min',
                'min_next_bid', a.starting_price, 'current_price', a.current_price);
        END IF;

        v_new_price := a.starting_price;
        IF a.reserve_price IS NOT NULL AND p_max_bid >= a.reserve_price THEN
            v_new_price := a.reserve_price;
        END IF;

        INSERT INTO public.bids (auction_id, bidder_id, amount, max_amount, is_proxy)
        VALUES (a.id, p_bidder_id, v_new_price, p_max_bid, false)
        RETURNING id INTO v_new_bid_id;
        v_rows_added := 1;
        v_is_high := true;

    ELSE
        -- ── Challenger vs incumbent. ──
        v_min_next := a.current_price + public.auction_bid_increment(a.current_price);
        IF p_max_bid < v_min_next THEN
            RETURN jsonb_build_object('accepted', false, 'reason', 'below_min',
                'min_next_bid', v_min_next, 'current_price', a.current_price);
        END IF;

        IF p_max_bid > v_high_max THEN
            -- Challenger wins. Incumbent's proxy is pushed to its ceiling first
            -- (a visible history row, only if that advances the price)...
            IF v_high_max > a.current_price THEN
                INSERT INTO public.bids (auction_id, bidder_id, amount, max_amount, is_proxy)
                VALUES (a.id, a.high_bidder_id, v_high_max, v_high_max, true);
                v_rows_added := v_rows_added + 1;
            END IF;

            -- ...then the challenger takes it one increment above that ceiling,
            -- capped at their own max; a covered reserve pulls the price up to it.
            v_new_price := LEAST(p_max_bid, v_high_max + public.auction_bid_increment(v_high_max));
            IF a.reserve_price IS NOT NULL AND p_max_bid >= a.reserve_price THEN
                v_new_price := GREATEST(v_new_price, LEAST(p_max_bid, a.reserve_price));
            END IF;

            INSERT INTO public.bids (auction_id, bidder_id, amount, max_amount, is_proxy)
            VALUES (a.id, p_bidder_id, v_new_price, p_max_bid, false)
            RETURNING id INTO v_new_bid_id;
            v_rows_added := v_rows_added + 1;
            v_is_high := true;
        ELSE
            -- Incumbent defends (tie goes to the earlier bidder). The
            -- challenger's bid lands at their max...
            INSERT INTO public.bids (auction_id, bidder_id, amount, max_amount, is_proxy)
            VALUES (a.id, p_bidder_id, p_max_bid, p_max_bid, false);
            v_rows_added := v_rows_added + 1;

            -- ...and the incumbent's proxy answers with the minimum that beats it.
            IF p_max_bid = v_high_max THEN
                v_new_price := v_high_max;
            ELSE
                v_new_price := LEAST(v_high_max, p_max_bid + public.auction_bid_increment(p_max_bid));
            END IF;
            IF a.reserve_price IS NOT NULL AND v_high_max >= a.reserve_price THEN
                v_new_price := GREATEST(v_new_price, LEAST(v_high_max, a.reserve_price));
            END IF;

            INSERT INTO public.bids (auction_id, bidder_id, amount, max_amount, is_proxy)
            VALUES (a.id, a.high_bidder_id, v_new_price, v_high_max, true)
            RETURNING id INTO v_new_bid_id;
            v_rows_added := v_rows_added + 1;
            v_is_high := false;
        END IF;
    END IF;

    -- ── Soft close: activity inside the final window extends the auction. ──
    IF a.ends_at - NOW() <= MAKE_INTERVAL(secs => a.soft_close_window_seconds) THEN
        a.ends_at := GREATEST(a.ends_at, NOW() + MAKE_INTERVAL(secs => a.soft_close_extension_seconds));
        a.extension_count := a.extension_count + 1;
        v_extended := true;
    END IF;

    UPDATE public.auctions SET
        current_price = v_new_price,
        high_bidder_id = CASE WHEN v_is_high THEN p_bidder_id ELSE high_bidder_id END,
        high_bid_id = v_new_bid_id,
        bid_count = bid_count + 1, -- one user action per accepted call (proxy rows excluded)
        reserve_met = (reserve_price IS NULL OR v_new_price >= reserve_price),
        ends_at = a.ends_at,
        extension_count = a.extension_count
    WHERE id = a.id;

    RETURN jsonb_build_object(
        'accepted', true,
        'reason', NULL,
        'auction_id', a.id,
        'current_price', v_new_price,
        'min_next_bid', v_new_price + public.auction_bid_increment(v_new_price),
        'is_high_bidder', v_is_high,
        'high_bidder_id', CASE WHEN v_is_high THEN p_bidder_id ELSE a.high_bidder_id END,
        'your_max', p_max_bid,
        'ends_at', a.ends_at,
        'extended', v_extended,
        'bid_count', a.bid_count + 1,
        'reserve_met', (a.reserve_price IS NULL OR v_new_price >= a.reserve_price)
    );
END;
$$;

-- ─── buy_now: instant close at the BIN price (only while no bids exist) ───

CREATE OR REPLACE FUNCTION public.buy_now(
    p_auction_id UUID,
    p_buyer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
BEGIN
    SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'not_found');
    END IF;
    IF a.status <> 'live' OR NOW() >= a.ends_at THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'ended');
    END IF;
    IF a.buy_now_price IS NULL THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'no_buy_now');
    END IF;
    IF a.bid_count > 0 THEN
        -- Classic rule: Buy-It-Now disappears once bidding has started.
        RETURN jsonb_build_object('accepted', false, 'reason', 'bidding_started');
    END IF;
    IF a.seller_id = p_buyer_id THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'own_auction');
    END IF;
    IF public.auction_bidding_suspended(p_buyer_id) THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'suspended');
    END IF;

    UPDATE public.auctions SET
        status = 'sold',
        winner_id = p_buyer_id,
        winning_amount = a.buy_now_price,
        won_via = 'buy_now',
        current_price = a.buy_now_price,
        reserve_met = true,
        closed_at = NOW(),
        ends_at = NOW()
    WHERE id = a.id;

    RETURN jsonb_build_object(
        'accepted', true,
        'auction_id', a.id,
        'winning_amount', a.buy_now_price
    );
END;
$$;

-- ─── cancel_auction: seller may cancel only while nobody has bid ───

CREATE OR REPLACE FUNCTION public.cancel_auction(
    p_auction_id UUID,
    p_seller_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
BEGIN
    SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;

    IF NOT FOUND OR a.seller_id <> p_seller_id THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'not_found');
    END IF;
    IF a.status <> 'live' THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'ended');
    END IF;
    IF a.bid_count > 0 THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'has_bids');
    END IF;

    UPDATE public.auctions SET status = 'cancelled', closed_at = NOW() WHERE id = a.id;
    RETURN jsonb_build_object('accepted', true);
END;
$$;

-- ─── close_due_auctions: the cron's atomic close pass ───
-- SKIP LOCKED so a concurrently-arriving bid (holding the row lock, possibly
-- extending ends_at) is simply left for the next tick. Each closed auction is
-- re-checked after lock acquisition because the extension may have landed
-- between the scan and the lock.

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
        WHERE status = 'live' AND ends_at <= NOW()
        ORDER BY ends_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        IF a.status <> 'live' OR a.ends_at > NOW() THEN
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

-- ─── void_overdue_auction_orders: deadbeat sweep ───
-- Winner didn't pay inside the window: CAS-cancel the order (a concurrent
-- payment wins and we back off), record a strike, and offer the runner-up a
-- second chance at THEIR max bid -- if one exists, clears the reserve, isn't
-- suspended, and this wasn't already a second chance. Otherwise the auction
-- goes unsold.

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

        -- The synthetic sold listing tied to the voided order is left as-is
        -- (born 'sold', never marketplace-visible); a second-chance settlement
        -- creates its own fresh listing row.
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

-- ─── accept / decline second-chance offers ───

CREATE OR REPLACE FUNCTION public.accept_second_chance(
    p_auction_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
BEGIN
    SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;

    IF NOT FOUND
       OR a.second_chance_status IS DISTINCT FROM 'offered'
       OR a.second_chance_offered_to IS DISTINCT FROM p_user_id THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'no_offer');
    END IF;
    IF a.second_chance_expires_at <= NOW() THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'expired');
    END IF;
    IF public.auction_bidding_suspended(p_user_id) THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'suspended');
    END IF;

    UPDATE public.auctions SET
        winner_id = p_user_id,
        winning_amount = a.second_chance_amount,
        won_via = 'second_chance',
        second_chance_status = 'accepted'
    WHERE id = a.id;

    RETURN jsonb_build_object(
        'accepted', true,
        'auction_id', a.id,
        'winning_amount', a.second_chance_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_second_chance(
    p_auction_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    a public.auctions%ROWTYPE;
BEGIN
    SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;

    IF NOT FOUND
       OR a.second_chance_status IS DISTINCT FROM 'offered'
       OR a.second_chance_offered_to IS DISTINCT FROM p_user_id THEN
        RETURN jsonb_build_object('accepted', false, 'reason', 'no_offer');
    END IF;

    UPDATE public.auctions SET
        status = 'unsold',
        winner_id = NULL,
        winning_amount = NULL,
        won_via = NULL,
        second_chance_status = 'declined'
    WHERE id = a.id;

    RETURN jsonb_build_object('accepted', true);
END;
$$;

-- ─── expire_second_chance_offers: lapse untouched offers ───

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

-- ─── Privileges: RPCs are service-role only ───
-- The API routes are the sole callers (after requireBeta + kill switch +
-- geo/profile gates); that's what makes the p_*_id parameters trustworthy.

REVOKE EXECUTE ON FUNCTION public.place_bid(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.buy_now(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_auction(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_due_auctions(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_overdue_auction_orders(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_second_chance(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decline_second_chance(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_second_chance_offers(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auction_bidding_suspended(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.place_bid(UUID, UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.buy_now(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_auction(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_due_auctions(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_overdue_auction_orders(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_second_chance(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.decline_second_chance(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_second_chance_offers(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.auction_bidding_suspended(UUID) TO service_role;
