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
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';

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
}

export const LOT_GUARD_COLS =
    'id, stream_id, seller_id, item_type, status, position, spots_total, spot_price, packs_per_spot, price, break_opened_at, card_data';

// The spot-based formats. 'buy_now' prices via `price`; 'auction' is a
// reserved seam the breaks MVP does not serve. 'character_break' needs
// 20260813_character_breaks_bulk.sql (item_type CHECK + break_entities).
export const BREAK_ITEM_TYPES = [
    'personal_break',
    'pick_your_pack',
    'random_pack',
    'chase_break',
    'pack_wars',
    'character_break',
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
