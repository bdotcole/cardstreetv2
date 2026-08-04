-- Live breaks (beta, dark until launch): streams + break lots + spots +
-- randomizer audit + chat + shipments. Whatnot-style live selling, TCG-focused.
--
-- ADDITIVE ONLY: new tables + nullable columns on profiles/orders. Applying
-- this changes nothing about existing app behavior — every new surface is
-- RLS-gated behind the 'live_streams' beta grant and served by beta-gated
-- routes that don't exist in the deployed app yet.
--
-- PRECONDITIONS (all already in this DB):
--   * auctions / auction_strikes / auction_bidding_suspended()  (20260704_auction_house, kept inert)
--   * beta_feature_flags + profiles.beta_features               (20260704_beta_features)
--   * rate_limits / bump_rate_limit()                           (20260702_rate_limits)
--   * update_updated_at_column()                                (20260518)
--
-- MONEY: spot/lot prices are INTEGER SATANG (BIGINT), converted to THB NUMERIC
-- at order creation (orders rail convention). Purchases ride the EXISTING
-- on-session checkout (PaymentModal, PromptPay included) — no off-session
-- Stripe surface is used by breaks.
--
-- BREAK FORMATS (TCG-native translation of the Whatnot suite; sports/team
-- formats can be added later as new item_type values):
--   personal_break  1 spot = the whole product; buyer keeps everything.
--   pick_your_pack  N numbered spots; buyer picks specific spot #s; spot k
--                   maps to pack k (deterministic).
--   random_pack     N spots; randomizer shuffles the spot->pack mapping live.
--   chase_break     N entry spots; the box's hits are randomizer-assigned to
--                   spots as pulled; filler minimum per spot is seller policy.
--   pack_wars       N entry spots; best pull wins (judging by seller on cam).
--   buy_now         a pinned fixed-price marketplace listing (non-break lot).
--   auction         reserved seam for the live-auction phase (auctions table).

-- ─── Beta flags (rows double as global kill switches) ───

INSERT INTO public.beta_feature_flags (feature, enabled) VALUES
    ('live_streams', true),
    ('live_broadcast', true)
ON CONFLICT (feature) DO NOTHING;

-- ─── Saved-card columns (PARKED: auction-phase off-session rail only) ───
-- Breaks do NOT use these; they're the seam for hammer-fall auto-charge later.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_customer_id_th TEXT,
    ADD COLUMN IF NOT EXISTS live_default_payment_method TEXT;

-- ─── streams ───

CREATE TABLE IF NOT EXISTS public.streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
    description TEXT,
    cover_image_url TEXT,
    game_id TEXT, -- one of the 6 games ('pokemon','yugioh',...) for discovery filtering

    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    -- 'unlisted' = link-only (rehearsals, private sales); excluded from feeds.
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    -- The single lot currently on the block (FK added after stream_items).
    current_item_id UUID,

    -- LiveKit: room name stored for ops; egress id + VOD kept 30 days for
    -- dispute resolution. Dual-cam = two publisher devices in ONE room
    -- (camera slot rides participant metadata, not schema).
    livekit_room TEXT,
    livekit_egress_id TEXT,
    vod_url TEXT,
    vod_expires_at TIMESTAMPTZ,

    chat_disabled BOOLEAN NOT NULL DEFAULT false,
    viewer_peak INTEGER NOT NULL DEFAULT 0,
    settled_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── stream_items (lots) ───

CREATE TABLE IF NOT EXISTS public.stream_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, -- denorm for RLS/RPC guards

    item_type TEXT NOT NULL CHECK (item_type IN
        ('personal_break', 'pick_your_pack', 'random_pack', 'chase_break', 'pack_wars',
         'buy_now', 'auction')),
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'active', 'sold', 'unsold', 'cancelled')),

    -- What's being ripped/sold: product snapshot (listings.card_data
    -- convention; sealed pc-* products ride along).
    card_data JSONB NOT NULL,
    listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL, -- buy_now pins / optional break source

    -- Break configuration (spot-based item_types).
    spots_total INTEGER CHECK (spots_total IS NULL OR spots_total BETWEEN 1 AND 200),
    spot_price BIGINT CHECK (spot_price IS NULL OR spot_price >= 100), -- satang
    packs_per_spot INTEGER NOT NULL DEFAULT 1 CHECK (packs_per_spot BETWEEN 1 AND 50),

    -- buy_now price (satang). Breaks price via spot_price.
    price BIGINT CHECK (price IS NULL OR price >= 100),

    -- auction seam (live-auction phase; unused by breaks MVP).
    auction_id UUID REFERENCES public.auctions(id) ON DELETE SET NULL,

    -- When the seller ripped the product on camera (VOD dispute anchor).
    break_opened_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT stream_items_break_shape CHECK (
        item_type NOT IN ('personal_break', 'pick_your_pack', 'random_pack', 'chase_break', 'pack_wars')
        OR (spots_total IS NOT NULL AND spot_price IS NOT NULL)
    ),
    CONSTRAINT stream_items_buy_now_shape CHECK (
        item_type <> 'buy_now' OR (price IS NOT NULL AND listing_id IS NOT NULL)
    )
);

ALTER TABLE public.streams
    ADD CONSTRAINT streams_current_item_id_fkey
    FOREIGN KEY (current_item_id) REFERENCES public.stream_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_items_auction
    ON public.stream_items (auction_id) WHERE auction_id IS NOT NULL;

-- ─── break_spots: the purchasable unit of every break format ───
-- Lifecycle: open -> held (checkout in progress, hold expires) -> sold.
-- A hold that expires is reclaimable by the next buyer (CAS in claim RPC).

CREATE TABLE IF NOT EXISTS public.break_spots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_item_id UUID NOT NULL REFERENCES public.stream_items(id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE, -- denorm
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, -- denorm

    spot_number INTEGER NOT NULL CHECK (spot_number >= 1),
    price BIGINT NOT NULL CHECK (price >= 100), -- satang snapshot at creation

    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'sold', 'cancelled')),
    held_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    hold_expires_at TIMESTAMPTZ,
    buyer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    sold_at TIMESTAMPTZ,

    -- Filled by the randomizer (random_pack: pack numbers; chase_break: hit
    -- descriptors are recorded in the randomization log, pack list here).
    assigned_packs INTEGER[],

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (stream_item_id, spot_number)
);

-- ─── break_randomizations: immutable fairness audit ───
-- Every randomizer run is logged with its seed + full assignment map and
-- announced in chat. Rows are never updated or deleted (no UPDATE path).

CREATE TABLE IF NOT EXISTS public.break_randomizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_item_id UUID NOT NULL REFERENCES public.stream_items(id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    run_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL, -- 'spot_to_pack' | 'hit_assignment' | ...
    seed TEXT NOT NULL,    -- server-generated entropy, shown on stream
    algorithm TEXT NOT NULL DEFAULT 'fisher-yates-sha256',
    assignments JSONB NOT NULL, -- e.g. [{"spot":1,"packs":[7]},...] or {"hit":"...","spot":4}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── stream_wins (PARKED: auction-phase hammer wins; breaks use break_spots) ───

CREATE TABLE IF NOT EXISTS public.stream_wins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    stream_item_id UUID NOT NULL UNIQUE REFERENCES public.stream_items(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    won_via TEXT NOT NULL CHECK (won_via IN ('bid', 'buy_now')),
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN
        ('pending', 'processing', 'paid', 'pay_window', 'failed', 'voided')),
    payment_intent_id TEXT,
    payment_due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── shipments: a buyer's N break orders from one stream -> ONE Flash parcel ───
-- Spot orders carry zero shipping; at stream close, settle groups a buyer's
-- paid orders into one shipment and issues a single shipping-fee order the
-- buyer pays ON-SESSION (existing pay-context rail). shipping_labels
-- (UNIQUE order_id) is untouched; shipment waybills live here.

CREATE TABLE IF NOT EXISTS public.shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stream_id UUID REFERENCES public.streams(id) ON DELETE SET NULL,

    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
        ('pending', 'awaiting_shipping_fee', 'label_created', 'shipped', 'delivered', 'completed', 'cancelled')),

    shipping_fee NUMERIC NOT NULL DEFAULT 0, -- THB (orders convention)
    shipping_fee_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,

    address_snapshot JSONB,
    weight_grams INTEGER,

    courier TEXT NOT NULL DEFAULT 'flash',
    tracking_number TEXT,
    -- OUR idempotency key, set BEFORE calling Flash — Flash does NOT dedupe
    -- outTradeNo (2026-07-01 duplicate-waybill incident).
    out_trade_no TEXT UNIQUE,
    label_url TEXT,

    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
    -- Provenance for live-break spot orders (listing_id stays NULL on them).
    ADD COLUMN IF NOT EXISTS break_spot_id UUID REFERENCES public.break_spots(id) ON DELETE SET NULL;

-- ─── chat ───
-- Persisted (not broadcast-only): Realtime postgres_changes delivers under
-- RLS, moderation can soft-delete, rows remain as dispute evidence next to
-- the VOD. Sends go through the API route (rate limit + ban + freeze checks);
-- there is deliberately NO INSERT policy.

CREATE TABLE IF NOT EXISTS public.stream_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
    is_system BOOLEAN NOT NULL DEFAULT false, -- 'Spot 4 -> @somchai', randomizer results, ...
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stream_chat_bans (
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    banned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, user_id)
);

-- ─── Indexes ───

CREATE INDEX IF NOT EXISTS idx_streams_status ON public.streams (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_streams_seller ON public.streams (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_items_stream ON public.stream_items (stream_id, position);
CREATE INDEX IF NOT EXISTS idx_break_spots_item ON public.break_spots (stream_item_id, spot_number);
CREATE INDEX IF NOT EXISTS idx_break_spots_buyer ON public.break_spots (buyer_id) WHERE buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_break_spots_expired_holds ON public.break_spots (hold_expires_at)
    WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_randomizations_item ON public.break_randomizations (stream_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shipments_buyer ON public.shipments (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_seller ON public.shipments (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shipment ON public.orders (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_break_spot ON public.orders (break_spot_id) WHERE break_spot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stream_chat_stream ON public.stream_chat_messages (stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_wins_stream ON public.stream_wins (stream_id);

-- ─── updated_at triggers (shared helper) ───

DROP TRIGGER IF EXISTS update_streams_updated_at ON public.streams;
CREATE TRIGGER update_streams_updated_at BEFORE UPDATE ON public.streams
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_stream_items_updated_at ON public.stream_items;
CREATE TRIGGER update_stream_items_updated_at BEFORE UPDATE ON public.stream_items
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_break_spots_updated_at ON public.break_spots;
CREATE TRIGGER update_break_spots_updated_at BEFORE UPDATE ON public.break_spots
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_stream_wins_updated_at ON public.stream_wins;
CREATE TRIGGER update_stream_wins_updated_at BEFORE UPDATE ON public.stream_wins
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_shipments_updated_at ON public.shipments;
CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON public.shipments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── RLS ───

ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.break_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.break_randomizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_wins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_chat_bans ENABLE ROW LEVEL SECURITY;

-- Dark against direct PostgREST reads: only beta users (or admins) see live
-- data; sellers always see their own. Same pattern as the auctions policy.
CREATE POLICY "Beta users can view streams" ON public.streams FOR SELECT
    USING (
        seller_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                   AND ('live_streams' = ANY(p.beta_features) OR p.role = 'admin'))
    );
CREATE POLICY "Beta users can view stream items" ON public.stream_items FOR SELECT
    USING (
        seller_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                   AND ('live_streams' = ANY(p.beta_features) OR p.role = 'admin'))
    );
CREATE POLICY "Beta users can view break spots" ON public.break_spots FOR SELECT
    USING (
        seller_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                   AND ('live_streams' = ANY(p.beta_features) OR p.role = 'admin'))
    );
CREATE POLICY "Beta users can view randomizations" ON public.break_randomizations FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                AND ('live_streams' = ANY(p.beta_features) OR p.role = 'admin'))
    );
CREATE POLICY "Buyers and sellers can view their stream wins" ON public.stream_wins FOR SELECT
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
CREATE POLICY "Buyers and sellers can view their shipments" ON public.shipments FOR SELECT
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
CREATE POLICY "Beta users can view stream chat" ON public.stream_chat_messages FOR SELECT
    USING (
        deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                    AND ('live_streams' = ANY(p.beta_features) OR p.role = 'admin'))
    );
CREATE POLICY "Sellers see bans on their streams, users their own" ON public.stream_chat_bans FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.streams s
                   WHERE s.id = stream_chat_bans.stream_id AND s.seller_id = auth.uid())
    );
-- No INSERT/UPDATE/DELETE policies anywhere: writes go through service-role
-- routes (requireBeta + kill switch + rate limits first).

-- ─── Realtime (postgres_changes respects RLS — dark on the wire) ───

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.streams;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stream_items;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.break_spots;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stream_chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── claim_break_spot: atomic first-tap-wins spot hold ───
-- Holds the spot for p_hold_seconds while the buyer pays on-session through
-- the existing checkout. An expired hold is stealable by the next claimant.
-- Suspension shares the auction deadbeat ledger.

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
    IF st.status <> 'live' THEN
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

-- ─── release_break_spot: back out of a hold (buyer cancels / checkout fails) ───

CREATE OR REPLACE FUNCTION public.release_break_spot(
    p_spot_id UUID,
    p_buyer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.break_spots SET
        status = 'open', held_by = NULL, hold_expires_at = NULL
    WHERE id = p_spot_id AND status = 'held' AND held_by = p_buyer_id;
    RETURN jsonb_build_object('released', FOUND);
END;
$$;

-- ─── finalize_break_spot: flip held -> sold once its order is paid ───
-- Called by the spot-checkout finalize route (and any webhook fallback) with
-- the paid order id. CAS-guarded + idempotent.

CREATE OR REPLACE FUNCTION public.finalize_break_spot(
    p_spot_id UUID,
    p_buyer_id UUID,
    p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    UPDATE public.break_spots SET
        status = 'sold', buyer_id = p_buyer_id, order_id = p_order_id,
        sold_at = NOW(), held_by = NULL, hold_expires_at = NULL
    WHERE id = p_spot_id
      AND (status = 'held' AND held_by = p_buyer_id
           OR (status = 'sold' AND buyer_id = p_buyer_id)); -- idempotent re-run
    v_ok := FOUND;

    RETURN jsonb_build_object('finalized', v_ok);
END;
$$;

-- ─── Privileges: RPCs are service-role only (bump_rate_limit pattern) ───

REVOKE EXECUTE ON FUNCTION public.claim_break_spot(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_break_spot(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_break_spot(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_break_spot(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_break_spot(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_break_spot(UUID, UUID, UUID) TO service_role;
