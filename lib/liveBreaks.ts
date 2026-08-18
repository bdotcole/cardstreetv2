/**
 * Shared server-side guards + helpers for the live-breaks routes.
 *
 * Two access shapes recur across every route:
 *   - requireBroadcaster / requireLotBroadcaster: 'live_broadcast' beta AND
 *     ownership of the stream/lot. Wrong-owner probes get the same 404 as a
 *     nonexistent id, mirroring lib/betaAuth.ts's no-hint posture.
 *   - requireViewerOrSeller: 'live_streams' beta OR being the stream's own
 *     seller — a broadcaster's grant may be 'live_broadcast' alone, and the
 *     seller must always see their own show (detail, chat, tokens).
 *
 * All reads here use the service-role client; RLS on the live tables is
 * SELECT-only for beta users and there are deliberately no INSERT policies.
 */

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { isFeatureEnabled, requireBeta } from '@/lib/betaAuth';
import { countRoomViewers } from '@/lib/livekit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { minNextBidSatang } from '@/lib/auctionRules';
import { CHECKOUT_HOLD_SECONDS, formatSatang } from '@/components/live/shared';

export interface StreamRow {
    id: string;
    seller_id: string;
    status: 'scheduled' | 'live' | 'ended' | 'cancelled';
    visibility: 'public' | 'unlisted';
    livekit_room: string | null;
    livekit_egress_id: string | null;
    chat_disabled: boolean;
    current_item_id: string | null;
    settled_at: string | null;
}

export const STREAM_GUARD_COLS =
    'id, seller_id, status, visibility, livekit_room, livekit_egress_id, chat_disabled, current_item_id, settled_at';

export interface LotRow {
    id: string;
    stream_id: string;
    seller_id: string;
    item_type: string;
    status: 'queued' | 'active' | 'sold' | 'unsold' | 'cancelled';
    position: number;
    spots_total: number | null;
    spot_price: number | null;
    packs_per_spot: number;
    price: number | null;
    break_opened_at: string | null;
    card_data: Record<string, unknown> | null;
    auction_id: string | null;
}

export const LOT_GUARD_COLS =
    'id, stream_id, seller_id, item_type, status, position, spots_total, spot_price, packs_per_spot, price, break_opened_at, card_data, auction_id';

// The spot-based formats. 'buy_now' prices via `price`; 'auction' sells its
// single spot through the live bid engine. 'character_break' needs
// 20260813_character_breaks_bulk.sql (item_type CHECK + break_entities);
// 'rip_till_hit' needs 20260818_rip_till_hit.sql (item_type CHECK +
// break_spots.hit_note/hit_at) — its spots are sequential TURNS, sold one at
// a time (claim route gate), fixed-price or auctioned per card_data.rtyhPricing.
export const BREAK_ITEM_TYPES = [
    'personal_break',
    'pick_your_pack',
    'random_pack',
    'chase_break',
    'pack_wars',
    'character_break',
    'rip_till_hit',
] as const;
export type BreakItemType = (typeof BREAK_ITEM_TYPES)[number];

export function isBreakItemType(t: string): t is BreakItemType {
    return (BREAK_ITEM_TYPES as readonly string[]).includes(t);
}

// ─── Character breaks + bulk discounts (20260813_character_breaks_bulk.sql) ───

export const ENTITY_LABEL_MAX = 40;
export const ENTITY_MIN = 2;
export const BULK_TIERS_MAX = 3;
export const BULK_DISCOUNT_MIN = 1;
export const BULK_DISCOUNT_MAX = 50;

export interface BreakEntity {
    key: string;
    label: string;
}

/**
 * Validate an untrusted character/team list (API body or stream_items
 * JSONB). Accepts [{key?,label}] or plain strings; labels are trimmed and
 * must be 1..40 chars. Keys are normalized to stable e1..eN in list order —
 * stored keys are NOT trusted (a duplicate key would alias two spots in the
 * randomizer's audit map). Returns null on any invalid entry; callers turn
 * null into a 400 (POST) or a friendly 409 (randomizer).
 */
export function parseBreakEntities(value: unknown): BreakEntity[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const out: BreakEntity[] = [];
    for (const raw of value) {
        const label =
            typeof raw === 'string'
                ? raw.trim()
                : raw && typeof raw === 'object' && typeof (raw as { label?: unknown }).label === 'string'
                    ? ((raw as { label: string }).label).trim()
                    : null;
        if (!label || label.length > ENTITY_LABEL_MAX) return null;
        out.push({ key: `e${out.length + 1}`, label });
    }
    return out;
}

export interface BulkTier {
    qty: number;
    discountPct: number;
}

/**
 * Validate untrusted bulk-discount tiers (API body or stream_items JSONB):
 * 1..3 tiers, integer qty strictly ascending starting at >= 2 (and <=
 * spotsTotal when given), integer discountPct 1..50. Returns null when the
 * shape is invalid — the lots POST turns null into a 400; checkout treats it
 * as "no bulk discount" so a malformed row can never mis-price a spot.
 */
export function parseBulkTiers(value: unknown, spotsTotal?: number | null): BulkTier[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > BULK_TIERS_MAX) return null;
    const tiers: BulkTier[] = [];
    let lastQty = 1;
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') return null;
        const { qty, discountPct } = raw as Record<string, unknown>;
        if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= lastQty) return null;
        if (spotsTotal != null && qty > spotsTotal) return null;
        if (
            typeof discountPct !== 'number' ||
            !Number.isInteger(discountPct) ||
            discountPct < BULK_DISCOUNT_MIN ||
            discountPct > BULK_DISCOUNT_MAX
        ) {
            return null;
        }
        tiers.push({ qty, discountPct });
        lastQty = qty;
    }
    return tiers;
}

export interface BroadcasterContext {
    user: User;
    stream: StreamRow;
}

/** 'live_broadcast' beta + ownership of the stream. */
export async function requireBroadcaster(
    streamId: string,
): Promise<BroadcasterContext | NextResponse> {
    const gate = await requireBeta('live_broadcast');
    if (gate instanceof NextResponse) return gate;

    const admin = createAdminClient();
    const { data: stream } = await admin
        .from('streams')
        .select(STREAM_GUARD_COLS)
        .eq('id', streamId)
        .maybeSingle<StreamRow>();

    if (!stream || stream.seller_id !== gate.user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return { user: gate.user, stream };
}

export interface LotBroadcasterContext {
    user: User;
    lot: LotRow;
    stream: StreamRow;
}

/** 'live_broadcast' beta + ownership of the lot (and its stream). */
export async function requireLotBroadcaster(
    lotId: string,
): Promise<LotBroadcasterContext | NextResponse> {
    const gate = await requireBeta('live_broadcast');
    if (gate instanceof NextResponse) return gate;

    const admin = createAdminClient();
    const { data: lot } = await admin
        .from('stream_items')
        .select(LOT_GUARD_COLS)
        .eq('id', lotId)
        .maybeSingle<LotRow>();

    // seller_id is denormalized onto stream_items exactly for this guard.
    if (!lot || lot.seller_id !== gate.user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: stream } = await admin
        .from('streams')
        .select(STREAM_GUARD_COLS)
        .eq('id', lot.stream_id)
        .maybeSingle<StreamRow>();
    if (!stream) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return { user: gate.user, lot, stream };
}

export interface ViewerContext {
    user: User;
    stream: StreamRow;
    isSeller: boolean;
}

/**
 * 'live_streams' beta viewer OR the stream's own seller. Only the
 * missing-grant 404 gets the seller fallback: 401 (no session) and 503
 * (global kill switch) apply to the seller too.
 */
export async function requireViewerOrSeller(
    streamId: string,
): Promise<ViewerContext | NextResponse> {
    const admin = createAdminClient();
    const { data: stream } = await admin
        .from('streams')
        .select(STREAM_GUARD_COLS)
        .eq('id', streamId)
        .maybeSingle<StreamRow>();

    const gate = await requireBeta('live_streams');
    if (!(gate instanceof NextResponse)) {
        if (!stream) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return { user: gate.user, stream, isSeller: stream.seller_id === gate.user.id };
    }

    if (gate.status !== 404) return gate;

    const cookieSupabase = await createServerClient();
    const { data: { user } } = await cookieSupabase.auth.getUser();
    // Same 404 the gate produced — a prober learns nothing from the fallback.
    if (!user || !stream || stream.seller_id !== user.id) return gate;
    return { user, stream, isSeller: true };
}

export interface PublicViewerContext {
    /** Null for a logged-out visitor — watching needs no account. */
    user: User | null;
    stream: StreamRow;
    isSeller: boolean;
}

/**
 * The WATCHING gate: anyone, signed in or not. A live show is public content
 * (that is the point of a shared link), so this resolves the stream and
 * whoever the caller happens to be, without ever refusing for lack of a
 * session.
 *
 * Read paths only — detail, feed, chat history, polls, and the viewer's
 * LiveKit token. Every path that SPENDS or SAYS something (claim, checkout,
 * bid, chat send, react, vote, remind) keeps requireBeta/requireViewerOrSeller
 * and still demands an account; the client prompts for sign-in at the moment
 * of the action instead of at the door.
 *
 * The global kill switch still applies: with 'live_streams' disabled nobody
 * watches, logged in or not.
 */
export async function resolvePublicViewer(
    streamId: string,
): Promise<PublicViewerContext | NextResponse> {
    if (!(await isFeatureEnabled('live_streams'))) {
        return NextResponse.json(
            { error: 'This feature is temporarily unavailable', code: 'FEATURE_DISABLED' },
            { status: 503 },
        );
    }

    const admin = createAdminClient();
    const { data: stream } = await admin
        .from('streams')
        .select(STREAM_GUARD_COLS)
        .eq('id', streamId)
        .maybeSingle<StreamRow>();
    if (!stream) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Best-effort identity: a cookie session when there is one, anonymous
    // otherwise. Never an error path — a stale/absent cookie just means guest.
    let user: User | null = null;
    try {
        const cookieSupabase = await createServerClient();
        const { data } = await cookieSupabase.auth.getUser();
        user = data.user ?? null;
    } catch {
        // Guest.
    }

    return { user, stream, isSeller: !!user && stream.seller_id === user.id };
}

// stream_chat_messages.body CHECK caps at 300 chars.
export const CHAT_BODY_MAX = 300;

// ─── Polls (20260811_stream_polls.sql) ───

export const POLL_QUESTION_MAX = 200;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 4;
export const POLL_OPTION_LABEL_MAX = 80;
export const POLL_OPTION_KEY_MAX = 32;

export interface PollOptionRow {
    key: string;
    label: string;
}

export interface PollRow {
    id: string;
    stream_id: string;
    seller_id: string;
    question: string;
    options: PollOptionRow[];
    tallies: Record<string, number> | null;
    status: 'open' | 'closed';
    created_at: string;
    closed_at: string | null;
}

export const POLL_COLS =
    'id, stream_id, seller_id, question, options, tallies, status, created_at, closed_at';

/**
 * CAS-cancel the caller's own unpaid orders for a set of spots.
 *
 * Two callers need exactly this write, which is why it lives here rather than
 * inline in either of them:
 *   - spots/checkout, as a duplicate guard — a buyer who abandons the sheet
 *     and re-enters would otherwise leave TWO payable groups on one spot, and
 *     both PaymentIntents stay chargeable (a stale PromptPay QR especially).
 *   - spots/abandon, when the buyer closes the sheet without paying — the
 *     pending group must die with the hold it was minted against.
 *
 * The CAS (buyer + spot + status='pending_payment') is the whole safety
 * story: someone else's orders and any already-paid order are untouchable,
 * so this can never cancel money that was actually collected. Returns false
 * on a write error; callers decide whether that is fatal.
 */
export async function cancelPendingSpotOrders(
    buyerId: string,
    spotIds: string[],
): Promise<boolean> {
    if (spotIds.length === 0) return true;
    const admin = createAdminClient();
    const { error } = await admin
        .from('orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('buyer_id', buyerId)
        .in('break_spot_id', spotIds)
        .eq('status', 'pending_payment');
    if (error) {
        console.error('[LiveBreaks] pending spot-order cancel failed:', error.message);
        return false;
    }
    return true;
}

/**
 * Pre-migration tolerance: PostgREST reports a table missing from its schema
 * cache as PGRST205 (older versions surface Postgres's 42P01). Poll routes
 * fail soft on it instead of 500ing until 20260811_stream_polls.sql runs.
 */
export function isMissingTableError(error: { code?: string } | null): boolean {
    return error?.code === 'PGRST205' || error?.code === '42P01';
}

/**
 * Full recount of a poll's votes into {optionKey: count}. Exact HEAD counts
 * per option (2-4 cheap queries) rather than paging vote rows, so the result
 * is never clipped by PostgREST row limits. The caller writes the result to
 * stream_polls.tallies — a concurrent vote's recount lands right after and
 * self-corrects any interleaving.
 */
export async function recountPollTallies(
    pollId: string,
    optionKeys: string[],
): Promise<Record<string, number>> {
    const admin = createAdminClient();
    const counts = await Promise.all(
        optionKeys.map(async (key) => {
            const { count, error } = await admin
                .from('stream_poll_votes')
                .select('*', { count: 'exact', head: true })
                .eq('poll_id', pollId)
                .eq('option_key', key);
            if (error) {
                console.error('[LiveBreaks] poll recount failed:', error.message);
                return [key, 0] as const;
            }
            return [key, count ?? 0] as const;
        }),
    );
    const tallies: Record<string, number> = {};
    for (const [key, count] of counts) tallies[key] = count;
    return tallies;
}

/**
 * Best-effort system chat row ('Spot 4 -> @somchai', randomizer results).
 * Never throws — an announcement failure must not fail the money path that
 * triggered it.
 */
export async function postSystemChat(
    streamId: string,
    senderId: string,
    body: string,
): Promise<void> {
    try {
        const admin = createAdminClient();
        const { error } = await admin.from('stream_chat_messages').insert({
            stream_id: streamId,
            sender_id: senderId,
            body: body.slice(0, CHAT_BODY_MAX),
            is_system: true,
        });
        if (error) {
            console.error('[LiveBreaks] system chat insert failed (non-fatal):', error.message);
        }
    } catch (err) {
        console.error('[LiveBreaks] system chat insert failed (non-fatal):', err);
    }
}

/**
 * Best-effort ephemeral broadcast onto the stream's room channel
 * (`stream-react:{streamId}` — see components/live/streamEvents.ts for the
 * event vocabulary). Same REST relay the sticker route uses. Never throws:
 * every caller has a durable fallback (detail refetch, system chat), so a
 * dropped push only delays the UI, never desyncs it.
 */
export async function broadcastStreamEvent(
    streamId: string,
    event: 'sticker' | 'auction' | 'spot_focus' | 'spot_sold' | 'viewer_joined',
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        const admin = createAdminClient();
        await admin.channel(`stream-react:${streamId}`).httpSend(event, payload);
    } catch (err) {
        console.error(`[LiveBreaks] ${event} broadcast failed (non-fatal):`, err);
    }
}

/**
 * Record the room's current viewer count into streams.viewer_peak — the
 * column had NO writer at all until 2026-08-18 (the first real show ended
 * with viewer_peak=0 and no way to tell reach from retention). Monotonic max
 * via the `.lt` filter, so concurrent bumps can only raise it. Best-effort:
 * peak tracking must never fail a join.
 *
 * `extraJoiners` covers the token-mint path, where the requester has not
 * connected to the room yet and would otherwise not count themselves.
 */
export async function recordViewerPeak(
    streamId: string,
    room: string,
    extraJoiners = 0,
): Promise<void> {
    try {
        const count = await countRoomViewers(room);
        if (count === null) return; // unknown ≠ zero — leave the peak alone
        const peak = count + extraJoiners;
        if (peak <= 0) return;
        const admin = createAdminClient();
        await admin
            .from('streams')
            .update({ viewer_peak: peak })
            .eq('id', streamId)
            .lt('viewer_peak', peak);
    } catch (err) {
        console.warn('[LiveBreaks] viewer peak record failed (non-fatal):', err);
    }
}

// ─── Live auctions (engine: 20260704_auction_house.sql, already in prod) ───

/** Live-mode sudden death: a bid in the final 10s extends the clock +10s. */
export const LIVE_SOFT_CLOSE_WINDOW_SECONDS = 10;
export const LIVE_SOFT_CLOSE_EXTENSION_SECONDS = 10;
/** Clock choices the console may set (seconds). */
export const LIVE_AUCTION_MIN_SECONDS = 15;
export const LIVE_AUCTION_MAX_SECONDS = 600;

export interface AuctionEngineRow {
    id: string;
    seller_id: string;
    /** 'stream-lot:<lotId>' (whole-lot auction) or 'stream-spot:<spotId>'
     *  (a rip_till_hit TURN auction — the hammer targets that spot). */
    card_id: string;
    status: 'live' | 'sold' | 'unsold' | 'cancelled';
    starting_price: number;
    current_price: number;
    bid_count: number;
    ends_at: string;
    extension_count: number;
    high_bidder_id: string | null;
    winner_id: string | null;
    winning_amount: number | null;
}

export const AUCTION_ENGINE_COLS =
    'id, seller_id, card_id, status, starting_price, current_price, bid_count, ends_at, ' +
    'extension_count, high_bidder_id, winner_id, winning_amount';

/** The turn spot a 'stream-spot:*' auction sells; null for whole-lot auctions. */
export function auctionTargetSpotId(auction: Pick<AuctionEngineRow, 'card_id'>): string | null {
    return auction.card_id.startsWith('stream-spot:')
        ? auction.card_id.slice('stream-spot:'.length)
        : null;
}

/**
 * The auction shape the live clients consume (LiveAuctionState in
 * components/live/shared.ts): engine row + display names + the server-computed
 * next-bid floor. Names resolve fail-soft — a missing profile renders as the
 * anonymous label, never blocks a money path.
 */
export async function shapeAuctionState(
    row: AuctionEngineRow,
): Promise<Record<string, unknown>> {
    const admin = createAdminClient();
    const ids = [row.high_bidder_id, row.winner_id].filter((v): v is string => !!v);
    const names = new Map<string, string | null>();
    if (ids.length > 0) {
        try {
            const { data } = await admin
                .from('profiles')
                .select('id, display_name')
                .in('id', ids)
                .returns<{ id: string; display_name: string | null }[]>();
            for (const p of data ?? []) names.set(p.id, p.display_name);
        } catch {
            // Names are decoration; the amounts are the payload.
        }
    }
    return {
        id: row.id,
        status: row.status,
        starting_price: row.starting_price,
        current_price: row.current_price,
        min_next_bid: minNextBidSatang(row.current_price, row.bid_count, row.starting_price),
        bid_count: row.bid_count,
        ends_at: row.ends_at,
        extension_count: row.extension_count,
        high_bidder_id: row.high_bidder_id,
        high_bidder_name: row.high_bidder_id ? names.get(row.high_bidder_id) ?? null : null,
        winner_id: row.winner_id,
        winner_name: row.winner_id ? names.get(row.winner_id) ?? null : null,
        winning_amount: row.winning_amount,
    };
}

export interface CloseAuctionResult {
    closed: boolean;
    /** 'sold' | 'unsold' when closed (or already closed), 'live' when not due. */
    status: string;
    auction: AuctionEngineRow | null;
    winnerHoldSet: boolean;
    /** The payment-vehicle spot the hammer put on hold (sold closes only). */
    spotId: string | null;
    /** The turn number when this was a rip_till_hit turn auction. */
    spotNumber: number | null;
}

/**
 * Targeted, migration-free hammer for ONE live-mode auction. CAS on
 * (status='live', ends_at unchanged since read, high bidder unchanged) —
 * place_bid rejects bids once NOW() >= ends_at, so a due auction's row is
 * frozen and the optimistic loop converges in one or two passes; a soft-close
 * extension between read and write simply fails the CAS and re-reads.
 *
 * With `force` (broadcaster's early hammer / "going twice... sold") the
 * due-check is skipped but the CAS still guarantees exactly one closer wins.
 *
 * On a sold close, the lot's single break spot flips to a checkout hold for
 * the winner at the winning amount — from there the EXISTING spot rail
 * (SpotPaymentSheet -> /api/live/spots/checkout -> finalize) owns the money.
 */
export async function closeLiveAuction(
    lot: LotRow,
    opts: { force?: boolean } = {},
): Promise<CloseAuctionResult | { error: string; status: number }> {
    const admin = createAdminClient();
    const auctionId = (lot as LotRow & { auction_id?: string | null }).auction_id;
    if (!auctionId) return { error: 'No auction on this lot', status: 409 };

    for (let attempt = 0; attempt < 3; attempt++) {
        const { data: a, error } = await admin
            .from('auctions')
            .select(AUCTION_ENGINE_COLS)
            .eq('id', auctionId)
            .maybeSingle<AuctionEngineRow>();
        if (error || !a) return { error: 'Auction not found', status: 404 };

        if (a.status !== 'live') {
            // Someone else already hammered it — report the settled state.
            return { closed: false, status: a.status, auction: a, winnerHoldSet: false, spotId: null, spotNumber: null };
        }

        const now = Date.now();
        if (!opts.force && Date.parse(a.ends_at) > now) {
            return { closed: false, status: 'live', auction: a, winnerHoldSet: false, spotId: null, spotNumber: null };
        }

        const won = a.high_bidder_id !== null;
        const closePatch = won
            ? {
                  status: 'sold',
                  winner_id: a.high_bidder_id,
                  winning_amount: a.current_price,
                  won_via: 'bid',
                  closed_at: new Date(now).toISOString(),
              }
            : { status: 'unsold', closed_at: new Date(now).toISOString() };

        // The CAS filters pin every field the outcome derives from; a bid
        // landing between read and write (possible only under `force`, or in
        // the soft-close window) zeroes the match and we re-read.
        let cas = admin
            .from('auctions')
            .update(closePatch)
            .eq('id', a.id)
            .eq('status', 'live')
            .eq('ends_at', a.ends_at)
            .eq('bid_count', a.bid_count);
        cas = a.high_bidder_id === null ? cas.is('high_bidder_id', null) : cas.eq('high_bidder_id', a.high_bidder_id);
        const { data: updated, error: casErr } = await cas.select(AUCTION_ENGINE_COLS).maybeSingle<AuctionEngineRow>();
        if (casErr) {
            console.error('[LiveBreaks] auction close CAS failed:', casErr.message);
            return { error: 'Failed to close auction', status: 500 };
        }
        if (!updated) continue; // lost the race — re-read

        let winnerHoldSet = false;
        let heldSpotId: string | null = null;
        let spotNumber: number | null = null;
        const targetSpotId = auctionTargetSpotId(updated);
        if (won && updated.winner_id) {
            // Hand the spot to the winner as a standard checkout hold. CAS on
            // status='open': an auctioned spot is never claimable (the claim
            // route refuses it), so open is the only pre-hammer state.
            // CHECKOUT_HOLD_SECONDS (5 min) is the pay window. A turn auction
            // (rip_till_hit) targets ITS spot by id; a whole-lot auction owns
            // the lot's single spot.
            let holdUpdate = admin
                .from('break_spots')
                .update({
                    price: updated.winning_amount ?? updated.current_price,
                    status: 'held',
                    held_by: updated.winner_id,
                    hold_expires_at: new Date(now + CHECKOUT_HOLD_SECONDS * 1000).toISOString(),
                })
                .eq('stream_item_id', lot.id)
                .eq('status', 'open');
            holdUpdate = targetSpotId ? holdUpdate.eq('id', targetSpotId) : holdUpdate;
            const { data: spotRow, error: spotErr } = await holdUpdate
                .select('id, spot_number')
                .maybeSingle<{ id: string; spot_number: number }>();
            if (spotErr) {
                console.error('[LiveBreaks] winner hold set failed:', spotErr.message);
            }
            winnerHoldSet = !!spotRow;
            heldSpotId = spotRow?.id ?? null;
            spotNumber = spotRow?.spot_number ?? null;
            if (!spotRow) {
                console.error(
                    `[LiveBreaks] auction ${updated.id} closed sold but its spot was not open — manual follow-up needed`,
                );
            }
        } else if (targetSpotId) {
            const { data: unsoldSpot } = await admin
                .from('break_spots')
                .select('spot_number')
                .eq('id', targetSpotId)
                .maybeSingle<{ spot_number: number }>();
            spotNumber = unsoldSpot?.spot_number ?? null;
        }

        return { closed: true, status: updated.status, auction: updated, winnerHoldSet, spotId: heldSpotId, spotNumber };
    }

    return { error: 'Auction is still receiving bids — try again', status: 409 };
}

/**
 * Close announcement shared by every hammer path (console close, the bid
 * route's lazy close on 'ended'): system chat line + an 'auction' broadcast
 * carrying the settled state. Fail-soft throughout.
 */
export async function announceAuctionClose(
    streamId: string,
    lot: LotRow,
    auction: AuctionEngineRow,
    winnerHoldSet: boolean,
    spotNumber?: number | null,
    autoCharged?: boolean,
): Promise<void> {
    const admin = createAdminClient();
    const baseName =
        typeof (lot.card_data as { name?: unknown } | null)?.name === 'string'
            ? (lot.card_data as { name: string }).name
            : 'Auction lot';
    const cardName = spotNumber != null ? `${baseName} — Turn #${spotNumber}` : baseName;
    if (auction.status === 'sold' && auction.winner_id) {
        let winnerName: string | null = null;
        try {
            const { data: p } = await admin
                .from('profiles')
                .select('display_name')
                .eq('id', auction.winner_id)
                .maybeSingle<{ display_name: string | null }>();
            winnerName = p?.display_name ?? null;
        } catch {
            // Name is decoration.
        }
        const amount = formatSatang(auction.winning_amount ?? auction.current_price);
        const payNote = autoCharged
            ? '' // finalize already announced the purchase; SOLD stands alone.
            : winnerHoldSet
                ? ' — check out from your Spots bar to pay'
                : '';
        await postSystemChat(
            streamId,
            lot.seller_id,
            `SOLD: ${cardName} to ${winnerName ?? 'the high bidder'} for ${amount}${payNote}`,
        );
    } else {
        await postSystemChat(streamId, lot.seller_id, `Auction ended with no bids: ${cardName}`);
    }
    const state = await shapeAuctionState(auction);
    await broadcastStreamEvent(streamId, 'auction', {
        lotId: lot.id,
        auction: state,
        at: Date.now(),
    });
}

/**
 * Flip lapsed holds on a stream's spots back to 'open' (release_expired_holds,
 * 20260815_release_expired_holds.sql).
 *
 * Hold expiry has no cron: this is a LAZY sweep, called at the top of the
 * reads that render or contend for a board, so a stream heals its own stale
 * holds the moment anyone looks at it. Scoped to one stream so a busy show
 * never sweeps the whole table; pass no id only from a deliberate global
 * sweep.
 *
 * Awaited (not detached) because the caller's very next query is the board
 * it must return — but never fatal: a sweep failure just leaves the board in
 * today's un-swept state, and the client already treats a lapsed hold as
 * claimable. Fails soft on 42883/PGRST202 (function absent pre-migration).
 */
export async function releaseExpiredHolds(streamId?: string): Promise<number> {
    try {
        const admin = createAdminClient();
        const { data, error } = await admin.rpc('release_expired_holds', {
            p_stream_id: streamId ?? null,
        });
        if (error) {
            if (error.code !== '42883' && error.code !== 'PGRST202') {
                console.error('[LiveBreaks] hold sweep failed (non-fatal):', error.message);
            }
            return 0;
        }
        return typeof data === 'number' ? data : 0;
    } catch (err) {
        console.error('[LiveBreaks] hold sweep failed (non-fatal):', err);
        return 0;
    }
}
