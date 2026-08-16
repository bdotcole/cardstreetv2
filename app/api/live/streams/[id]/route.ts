/**
 * GET    /api/live/streams/[id] — stream detail + lots + spots.
 * DELETE /api/live/streams/[id] — hard-delete a finished, money-free show.
 *
 * GET: beta viewers and the stream's own seller (who may hold only the
 * 'live_broadcast' grant) both pass. Unlisted streams resolve here — that IS
 * the link-only distribution model; only the public feed excludes them.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    AUCTION_ENGINE_COLS,
    releaseExpiredHolds,
    requireBroadcaster,
    requireViewerOrSeller,
    shapeAuctionState,
    type AuctionEngineRow,
} from '@/lib/liveBreaks';

// Explicit projection instead of select('*'): livekit_egress_id is an
// infrastructure handle and the VOD fields are the seller's dispute material
// — viewers have no use for either, so only the seller's own fetch gets them.
const STREAM_VIEWER_COLS =
    'id, seller_id, title, description, cover_image_url, game_id, status, ' +
    'visibility, scheduled_at, started_at, ended_at, current_item_id, ' +
    'livekit_room, chat_disabled, viewer_peak, settled_at, created_at, updated_at';
const STREAM_SELLER_COLS =
    `${STREAM_VIEWER_COLS}, livekit_egress_id, vod_url, vod_expires_at`;

interface SpotBoardRow {
    id: string;
    stream_item_id: string;
    spot_number: number;
    price: number;
    status: string;
    held_by: string | null;
    hold_expires_at: string | null;
    buyer_id: string | null;
    order_id: string | null;
    sold_at: string | null;
    assigned_packs: number[] | null;
    /** Absent until 20260813_character_breaks_bulk.sql is applied. */
    assigned_entity?: string | null;
    /** Absent until 20260818_rip_till_hit.sql is applied. */
    hit_note?: string | null;
    hit_at?: string | null;
}

const SPOT_BOARD_COLS =
    'id, stream_item_id, spot_number, price, status, held_by, ' +
    'hold_expires_at, buyer_id, order_id, sold_at, assigned_packs';

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;

        const admin = createAdminClient();

        // Lazy hold sweep: no cron owns hold expiry, so the board load that
        // would otherwise RENDER a lapsed hold as reserved is the thing that
        // clears it. Scoped to this stream, awaited so the spots query below
        // reads the swept state, and fail-soft (see releaseExpiredHolds).
        await releaseExpiredHolds(id);

        const baseCols = ctx.isSeller ? STREAM_SELLER_COLS : STREAM_VIEWER_COLS;
        const sellerJoin = 'seller:profiles!streams_seller_id_fkey(display_name, avatar_url)';
        let { data: stream, error: streamErr } = await admin
            .from('streams')
            .select(`${baseCols}, layout, ${sellerJoin}`)
            .eq('id', id)
            .single();

        // layout (20260807_stream_layout.sql) is additive and applied by hand
        // — until it exists, serve the detail without framing data instead of
        // 404ing every viewer on an undefined-column error.
        if (streamErr && streamErr.code === '42703') {
            ({ data: stream, error: streamErr } = await admin
                .from('streams')
                .select(`${baseCols}, ${sellerJoin}`)
                .eq('id', id)
                .single());
        }

        if (streamErr || !stream) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const [{ data: items }, spotsResult] = await Promise.all([
            admin
                .from('stream_items')
                .select('*')
                .eq('stream_id', id)
                .order('position', { ascending: true })
                .order('created_at', { ascending: true }),
            admin
                .from('break_spots')
                .select(`${SPOT_BOARD_COLS}, assigned_entity, hit_note, hit_at`)
                .eq('stream_id', id)
                .order('spot_number', { ascending: true })
                .returns<SpotBoardRow[]>(),
        ]);

        // Degrade ladder for hand-applied additive columns, newest first:
        // hit_note/hit_at (20260818_rip_till_hit.sql), then assigned_entity
        // (20260813_character_breaks_bulk.sql) — the board itself must always
        // serve.
        let spots = spotsResult.data;
        if (spotsResult.error && spotsResult.error.code === '42703') {
            ({ data: spots } = await admin
                .from('break_spots')
                .select(`${SPOT_BOARD_COLS}, assigned_entity`)
                .eq('stream_id', id)
                .order('spot_number', { ascending: true })
                .returns<SpotBoardRow[]>());
            if (!spots) {
                ({ data: spots } = await admin
                    .from('break_spots')
                    .select(SPOT_BOARD_COLS)
                    .eq('stream_id', id)
                    .order('spot_number', { ascending: true })
                    .returns<SpotBoardRow[]>());
            }
        }

        // order_id is a payment linkage, not board state — only the spot's own
        // buyer and the seller get it. buyer_id stays: the spot board shows
        // owners by design.
        const visibleSpots = (spots ?? []).map(s =>
            ctx.isSeller || (s.buyer_id !== null && s.buyer_id === ctx.user.id)
                ? s
                : { ...s, order_id: null },
        );

        // Auction lots: viewers can't read the auctions table (its RLS belongs
        // to the timed-auction beta), so live auction state is enriched onto
        // the lot HERE — the room's broadcast pushes keep it fresh between
        // loads. Fail-soft: an enrichment error serves the lot un-enriched.
        let enrichedItems: Record<string, unknown>[] = (items ?? []) as Record<string, unknown>[];
        const auctionIds = enrichedItems
            .map((it) => (typeof it.auction_id === 'string' ? it.auction_id : null))
            .filter((v): v is string => !!v);
        if (auctionIds.length > 0) {
            try {
                const { data: auctionRows } = await admin
                    .from('auctions')
                    .select(AUCTION_ENGINE_COLS)
                    .in('id', auctionIds)
                    .returns<AuctionEngineRow[]>();
                const shaped = new Map<string, Record<string, unknown>>();
                for (const row of auctionRows ?? []) {
                    shaped.set(row.id, await shapeAuctionState(row));
                }
                enrichedItems = enrichedItems.map((it) =>
                    typeof it.auction_id === 'string' && shaped.has(it.auction_id)
                        ? { ...it, auction: shaped.get(it.auction_id) }
                        : it,
                );
            } catch (err) {
                console.error('[Live/Stream] auction enrichment failed (non-fatal):', err);
            }
        }

        return NextResponse.json({
            stream,
            items: enrichedItems,
            spots: visibleSpots,
        });
    } catch (err: any) {
        console.error('[Live/Stream] GET error:', err);
        return NextResponse.json({ error: 'Failed to load stream' }, { status: 500 });
    }
}

/**
 * Hard-delete an ended/cancelled show from the studio list, ONLY when no
 * money ever touched it: zero sold spots AND zero orders referencing its
 * spots (checkout creates pending_payment orders with break_spot_id set
 * before a spot ever flips sold — those rows are dispute material too, so
 * they block deletion just like sales). FK cascades cover the children
 * (stream_items, break_spots, chat, randomizations); orders/shipments only
 * SET NULL, which is exactly why the money guard must refuse first.
 */
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { stream } = ctx;

        if (stream.status !== 'ended' && stream.status !== 'cancelled') {
            return NextResponse.json(
                { error: 'Only ended or cancelled shows can be deleted' },
                { status: 409 },
            );
        }

        const admin = createAdminClient();

        const { data: spotRows, error: spotsErr } = await admin
            .from('break_spots')
            .select('id, status, order_id')
            .eq('stream_id', stream.id)
            .returns<{ id: string; status: string; order_id: string | null }[]>();
        if (spotsErr) {
            console.error('[Live/Stream] DELETE spot check failed:', spotsErr.message);
            return NextResponse.json({ error: 'Failed to delete the show' }, { status: 500 });
        }

        let hasMoney = (spotRows ?? []).some(
            (s) => s.status === 'sold' || s.order_id !== null,
        );

        // Orders reference spots one-way (orders.break_spot_id); chunk the id
        // list so a big board can't overflow the PostgREST filter URL.
        if (!hasMoney && spotRows && spotRows.length > 0) {
            const ids = spotRows.map((s) => s.id);
            for (let i = 0; i < ids.length && !hasMoney; i += 150) {
                const { data: orderRows, error: ordersErr } = await admin
                    .from('orders')
                    .select('id')
                    .in('break_spot_id', ids.slice(i, i + 150))
                    .limit(1);
                if (ordersErr) {
                    console.error('[Live/Stream] DELETE order check failed:', ordersErr.message);
                    return NextResponse.json(
                        { error: 'Failed to delete the show' },
                        { status: 500 },
                    );
                }
                if ((orderRows ?? []).length > 0) hasMoney = true;
            }
        }

        // Belt-and-suspenders for the reserved buy_now seam: a win row means
        // an order existed even if the spot linkage was cleared.
        if (!hasMoney) {
            const { data: winRows, error: winsErr } = await admin
                .from('stream_wins')
                .select('id')
                .eq('stream_id', stream.id)
                .limit(1);
            if (winsErr) {
                console.error('[Live/Stream] DELETE wins check failed:', winsErr.message);
                return NextResponse.json({ error: 'Failed to delete the show' }, { status: 500 });
            }
            if ((winRows ?? []).length > 0) hasMoney = true;
        }

        if (hasMoney) {
            return NextResponse.json(
                {
                    error: 'This show has sold spots or orders and cannot be deleted',
                    code: 'HAS_SALES',
                },
                { status: 409 },
            );
        }

        const { error: delErr } = await admin
            .from('streams')
            .delete()
            .eq('id', stream.id)
            .eq('seller_id', ctx.user.id);
        if (delErr) {
            console.error('[Live/Stream] DELETE failed:', delErr.message);
            return NextResponse.json({ error: 'Failed to delete the show' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Live/Stream] DELETE error:', err);
        return NextResponse.json({ error: 'Failed to delete the show' }, { status: 500 });
    }
}
