/**
 * Client-shared row shapes + tiny formatters for the live-breaks UI.
 *
 * The row interfaces mirror what the /api/live routes return (which is what
 * Supabase Realtime also delivers as payload.new), so pages can patch their
 * state directly from either source without re-mapping.
 */

export interface LiveStreamRow {
    id: string;
    seller_id: string;
    title: string;
    description: string | null;
    cover_image_url: string | null;
    game_id: string | null;
    status: 'scheduled' | 'live' | 'ended' | 'cancelled';
    visibility: 'public' | 'unlisted';
    scheduled_at: string | null;
    started_at: string | null;
    ended_at: string | null;
    current_item_id: string | null;
    livekit_room: string | null;
    chat_disabled: boolean;
    viewer_peak: number;
    pinned_message?: string | null;
    pinned_at?: string | null;
    settled_at: string | null;
    created_at: string;
    /** Optional until 20260807_stream_layout.sql is applied — absent = default framing. */
    layout?: StreamLayout | null;
    seller?: { display_name: string | null; avatar_url: string | null } | null;
    /** Feed-only annotation: a scheduled show with at least one presale lot. */
    presale_open?: boolean;
}

/**
 * Presentation-layer crop for one feed: the viewer sees a 1/zoom window of
 * the video, positioned by x/y (0 = window at the left/top edge, 1 = at the
 * right/bottom edge, 0.5 = centered). Applied as pure CSS in
 * CroppedTrackVideo — no video processing anywhere.
 *
 * `fit` decides how the feed meets its slot BEFORE zoom/pan apply: 'cover'
 * center-crops to fill (the classic look), 'contain' shows the full frame
 * letterboxed over a blurred backdrop — the fix for a portrait table cam
 * whose FOV was being destroyed by the wide slot's center-crop. Absent =
 * the slot's default (DEFAULT_FIT), so pre-fit stored layouts keep working.
 */
export type FeedFit = 'cover' | 'contain';

export interface FeedCrop {
    zoom: number;
    x: number;
    y: number;
    fit?: FeedFit;
}

/** streams.layout — per-camera-slot framing the broadcaster set. */
export interface StreamLayout {
    main?: FeedCrop | null;
    table?: FeedCrop | null;
    /**
     * Face (main) cam's share of the stacked dual-feed height, 0.2..0.8.
     * Follows the SLOT, not the screen position — a viewer swapping which
     * feed is on top keeps each camera's share. Absent (pre-ratio rows) =
     * DEFAULT_RATIO.
     */
    ratio?: number | null;
}

export const DEFAULT_CROP: FeedCrop = { zoom: 1, x: 0.5, y: 0.5 };
export const DEFAULT_RATIO = 0.4;

/**
 * Per-slot fit defaults: the face cam fills its slot (a cropped face is
 * fine), the table cam shows its FULL field of view — table phones publish
 * portrait 1080x1920 and cover-cropping that into the wide lower slot both
 * zoomed it ~2.4x and threw away most of the table.
 */
export const DEFAULT_FIT: Record<'main' | 'table', FeedFit> = {
    main: 'cover',
    table: 'contain',
};

/** The slot's effective fit — the stored crop's valid `fit` or the slot default. */
export function resolveFit(
    slot: 'main' | 'table',
    crop?: { fit?: FeedFit | null } | null,
): FeedFit {
    return crop?.fit === 'cover' || crop?.fit === 'contain' ? crop.fit : DEFAULT_FIT[slot];
}

/**
 * Validate + clamp an untrusted split ratio (API body, DB JSONB). Null for
 * non-numbers — callers treat null as "use DEFAULT_RATIO". Clamped to
 * 0.2..0.8 so neither feed can be dragged into a sliver, rounded like crops.
 */
export function clampRatio(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.round(Math.min(0.8, Math.max(0.2, value)) * 10000) / 10000;
}

/**
 * Validate + clamp an untrusted crop (API body, DB JSONB). Returns null for
 * anything that isn't three finite numbers — callers treat null as "no crop".
 * Values are clamped (zoom 1..3, x/y 0..1) and rounded so drag deltas don't
 * persist as 15-decimal floats. A valid `fit` passes through; anything else
 * is dropped so the slot default applies (resolveFit).
 */
export function clampCrop(value: unknown): FeedCrop | null {
    if (!value || typeof value !== 'object') return null;
    const { zoom, x, y, fit } = value as Record<string, unknown>;
    if (typeof zoom !== 'number' || typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const round = (n: number) => Math.round(n * 10000) / 10000;
    const clamped: FeedCrop = {
        zoom: round(Math.min(3, Math.max(1, zoom))),
        x: round(Math.min(1, Math.max(0, x))),
        y: round(Math.min(1, Math.max(0, y))),
    };
    if (fit === 'cover' || fit === 'contain') clamped.fit = fit;
    return clamped;
}

export interface LiveLotRow {
    id: string;
    stream_id: string;
    seller_id: string;
    item_type: string;
    position: number;
    status: 'queued' | 'active' | 'sold' | 'unsold' | 'cancelled';
    card_data: { name?: string; isSealed?: boolean; productType?: string | null; images?: { small?: string; large?: string } } | null;
    listing_id: string | null;
    spots_total: number | null;
    spot_price: number | null; // satang
    packs_per_spot: number;
    price: number | null; // satang
    break_opened_at: string | null;
    created_at: string;
    /** auction lots: FK into the (inert-until-live-auction) auctions engine. */
    auction_id?: string | null;
    /** Server-enriched auction state (GET detail); broadcast pushes update it. */
    auction?: LiveAuctionState | null;
    /** Optional until 20260810_presales.sql is applied — absent = no presale. */
    presale_enabled?: boolean;
    /** character_break's character/team list. Optional until 20260813_character_breaks_bulk.sql. */
    break_entities?: { key: string; label: string }[] | null;
    /** Bulk-discount tiers (read via bulkTiersOf). Optional until 20260813_character_breaks_bulk.sql. */
    bulk_tiers?: unknown;
    /** Per-spot shipping increment (satang) on every spot after a buyer's
     *  first from this lot. Optional until 20260816_first_checkout_shipping.sql. */
    incremental_ship_satang?: number;
}

export interface LiveSpotRow {
    id: string;
    stream_item_id: string;
    spot_number: number;
    price: number; // satang
    status: 'open' | 'held' | 'sold' | 'cancelled';
    held_by: string | null;
    hold_expires_at: string | null;
    buyer_id: string | null;
    order_id: string | null;
    sold_at: string | null;
    assigned_packs: number[] | null;
    /** character_break randomizer result. Optional until 20260813_character_breaks_bulk.sql. */
    assigned_entity?: string | null;
    /** rip_till_hit: the turn's recorded hit. Optional until 20260818_rip_till_hit.sql. */
    hit_note?: string | null;
    hit_at?: string | null;
}

// ─── Rip 'Til You Hit (rip_till_hit) ───
// Spots are sequential TURNS: exactly one is purchasable at a time, the
// breaker rips until a hit and records it, then the next turn opens. The
// pricing mode rides the lot's card_data snapshot (no schema column).

export type RtyhPricing = 'fixed' | 'auction';

/** The lot's turn-pricing mode; anything unrecognized reads as 'fixed'. */
export function rtyhPricingOf(lot: { card_data: unknown }): RtyhPricing {
    const raw = (lot.card_data as { rtyhPricing?: unknown } | null)?.rtyhPricing;
    return raw === 'auction' ? 'auction' : 'fixed';
}

/**
 * The single purchasable turn RIGHT NOW: the lowest-numbered available spot
 * (open, or a lapsed hold) with every lower-numbered spot already SOLD. A
 * live hold on the next turn blocks everything behind it — the queue only
 * advances on money, never past a buyer mid-checkout. Null when sold out or
 * while the next turn is being held/paid.
 */
export function nextTurnSpot(lotSpots: LiveSpotRow[], now: number): LiveSpotRow | null {
    const ordered = [...lotSpots].sort((a, b) => a.spot_number - b.spot_number);
    for (const spot of ordered) {
        if (spot.status === 'sold' || spot.status === 'cancelled') continue;
        return isSpotOpenNow(spot, now) ? spot : null;
    }
    return null;
}

/** The turn being ripped: the lowest sold spot whose hit isn't recorded yet. */
export function currentTurnSpot(lotSpots: LiveSpotRow[]): LiveSpotRow | null {
    const ordered = [...lotSpots].sort((a, b) => a.spot_number - b.spot_number);
    return ordered.find((s) => s.status === 'sold' && !s.hit_at && !s.hit_note) ?? null;
}

/** The two fields every availability check reads — accepts any spot-shaped row. */
type SpotHoldFields = Pick<LiveSpotRow, 'status' | 'hold_expires_at'>;

/**
 * A 'held' spot whose hold_expires_at has passed. Such a row is functionally
 * OPEN — claim_break_spot steals it on the next tap — but the stored status
 * still says 'held' until a sweep (release_expired_holds) runs, and that
 * sweep is lazy, triggered by board loads and claims rather than a cron.
 *
 * So the DB status alone is NEVER the answer on the client: a board that
 * reads it raw paints an abandoned spot as reserved to the whole room for as
 * long as nobody happens to reload. Availability goes through isSpotOpenNow.
 */
export function isHoldLapsed(spot: SpotHoldFields, now: number): boolean {
    return (
        spot.status === 'held' &&
        !!spot.hold_expires_at &&
        Date.parse(spot.hold_expires_at) <= now
    );
}

/** Should the board treat this spot as available? Open, or a lapsed hold. */
export function isSpotOpenNow(spot: SpotHoldFields, now: number): boolean {
    return spot.status === 'open' || isHoldLapsed(spot, now);
}

/**
 * Stripe's minimum chargeable amount in THB is ฿10.00 (1000 satang); a
 * PaymentIntent below it is rejected outright with `amount_too_small`. Only a
 * buyer's FIRST spot batch in a stream carries a shipping fee to lift a cheap
 * lot over the line the way a marketplace order does — later batches ship
 * free (or a small per-lot increment), so a single ฿1 spot is unchargeable —
 * the floor has to be enforced by us, at lot creation and again at checkout,
 * or the buyer meets Stripe's raw error at the payment sheet.
 *
 * The break_spots CHECK constraint stays at >= 100 satang deliberately: this
 * is a route-level floor, so raising it later needs no migration.
 */
export const MIN_CHARGE_SATANG = 1000;

/**
 * How long a hold is extended for once the buyer commits to paying (order
 * creation). The 180s claim hold is sized for browsing the board; PromptPay
 * approval routinely outruns it, so the payment window gets its own budget.
 * Five minutes is the product call: long enough for a QR approval, short
 * enough that an abandoned sheet doesn't strand a spot for the whole break.
 *
 * The client never re-derives this — countdowns render from the server's
 * `hold_expires_at`, so this constant has exactly one consumer and the UI
 * cannot drift out of sync with it.
 */
export const CHECKOUT_HOLD_SECONDS = 300;

export interface LiveBulkTier {
    qty: number;
    discountPct: number;
}

/**
 * Tolerant client-side read of a lot's bulk_tiers JSONB — [] for anything
 * mis-shaped, so a bad row renders no badges instead of crashing the board.
 * (The server re-validates independently at checkout; this never prices.)
 */
export function bulkTiersOf(raw: unknown): LiveBulkTier[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) return [];
    const tiers: LiveBulkTier[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') return [];
        const { qty, discountPct } = entry as Record<string, unknown>;
        if (typeof qty !== 'number' || typeof discountPct !== 'number') return [];
        if (!Number.isInteger(qty) || !Number.isInteger(discountPct)) return [];
        tiers.push({ qty, discountPct });
    }
    return tiers;
}

/** "3+ = -10%" — the bulk-tier badge on spot boards and lot rows. */
export function formatBulkTier(tier: LiveBulkTier): string {
    return `${tier.qty}+ = -${tier.discountPct}%`;
}

// ─── Live auctions ───
// The engine (auctions table + place_bid RPC, 20260704_auction_house.sql) is
// already in prod, service-role-only. The live UI never reads the table
// directly (its RLS wants the 'auctions' grant): state arrives through the
// stream detail GET (server-enriched onto the lot) and through 'auction'
// broadcast pushes after every accepted bid — see components/live/streamEvents.

export interface LiveAuctionState {
    id: string;
    status: 'live' | 'sold' | 'unsold' | 'cancelled';
    starting_price: number; // satang
    current_price: number; // satang
    min_next_bid: number; // satang — server-computed, never derived client-side
    bid_count: number;
    ends_at: string;
    extension_count: number;
    high_bidder_id: string | null;
    high_bidder_name: string | null;
    winner_id?: string | null;
    winner_name?: string | null;
    winning_amount?: number | null;
}

/** Console picker choices for a live lot's clock (seconds). */
export const AUCTION_DURATION_CHOICES = [30, 60, 120, 300] as const;
export const AUCTION_DURATION_DEFAULT = 60;

export interface LivePollOption {
    key: string;
    label: string;
}

export interface LivePollRow {
    id: string;
    stream_id: string;
    seller_id: string;
    question: string;
    options: LivePollOption[];
    /** Full recount written server-side after every vote; missing key = 0. */
    tallies: Record<string, number> | null;
    status: 'open' | 'closed';
    created_at: string;
    closed_at: string | null;
}

/** Total votes across a poll's options (tolerates missing tally keys). */
export function pollTotalVotes(poll: LivePollRow): number {
    const tallies = poll.tallies ?? {};
    return (poll.options ?? []).reduce((sum, o) => sum + (tallies[o.key] ?? 0), 0);
}

export interface LiveChatMessage {
    /** Client-synthesized "[name] has joined" line (never persisted; the
     *  name rides in `body`). Absent on real rows from the API. */
    join?: boolean;
    id: string;
    stream_id: string;
    sender_id: string;
    body: string;
    is_system: boolean;
    created_at: string;
    sender?: { display_name: string | null; avatar_url: string | null } | null;
}

/** Spot/lot money is INTEGER SATANG everywhere in the live schema; the UI is
 *  THB-only (live selling is Thailand-gated), so no currency switching here. */
export function formatSatang(satang: number): string {
    const thb = satang / 100;
    return `฿${thb.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: thb % 1 === 0 ? 0 : 2,
    })}`;
}

/** "Somchai P." -> "SP" — the sold-spot owner marker on the board. */
export function nameInitials(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0] ?? '';
    const second = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : parts[0][1] ?? '';
    return (first + second).toUpperCase();
}

export function formatCountdown(msLeft: number): string {
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The Capacitor shells mark themselves two ways: the CardStreetApp UA marker
 * (Android ships it; iOS from 1.0.4) and the injected Capacitor bridge (all
 * shells, including the pre-marker iOS binary). Same belt-and-suspenders
 * detection as components/PremiumHub.tsx. The camera pages use it only to
 * decide whether a FAILED capture has somewhere to escape to (a real browser
 * always can) — never to gate the attempt: the WebView does grant
 * getUserMedia, so broadcasting starts in-app like anywhere else.
 */
export function isNativeShell(): boolean {
    if (typeof window === 'undefined') return false;
    if (navigator.userAgent.includes('CardStreetApp')) return true;
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : true);
}

/**
 * Open a URL in a real browser from inside the native shell — the same
 * Capacitor Browser (Custom Tab) + window.open('_system') fallback convention
 * as components/StripeConnectSection.tsx's openStripeUrl. Camera pages must
 * go through this: getUserMedia works in a Custom Tab (it's Chrome), never in
 * the app WebView. URL fragments survive the handoff, so the table-cam's
 * #-carried LiveKit token stays intact and off the wire.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
    try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
    } catch {
        window.open(url, '_system');
    }
}
