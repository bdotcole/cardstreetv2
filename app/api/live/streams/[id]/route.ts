/**
 * GET /api/live/streams/[id] — stream detail + lots + spots.
 *
 * Beta viewers and the stream's own seller (who may hold only the
 * 'live_broadcast' grant) both pass. Unlisted streams resolve here — that IS
 * the link-only distribution model; only the public feed excludes them.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireViewerOrSeller } from '@/lib/liveBreaks';

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
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;

        const admin = createAdminClient();

        const { data: stream, error: streamErr } = await admin
            .from('streams')
            .select(
                `${ctx.isSeller ? STREAM_SELLER_COLS : STREAM_VIEWER_COLS}, ` +
                'seller:profiles!streams_seller_id_fkey(display_name, avatar_url)',
            )
            .eq('id', id)
            .single();

        if (streamErr || !stream) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const [{ data: items }, { data: spots }] = await Promise.all([
            admin
                .from('stream_items')
                .select('*')
                .eq('stream_id', id)
                .order('position', { ascending: true })
                .order('created_at', { ascending: true }),
            admin
                .from('break_spots')
                .select(
                    'id, stream_item_id, spot_number, price, status, held_by, ' +
                    'hold_expires_at, buyer_id, order_id, sold_at, assigned_packs',
                )
                .eq('stream_id', id)
                .order('spot_number', { ascending: true })
                .returns<SpotBoardRow[]>(),
        ]);

        // order_id is a payment linkage, not board state — only the spot's own
        // buyer and the seller get it. buyer_id stays: the spot board shows
        // owners by design.
        const visibleSpots = (spots ?? []).map(s =>
            ctx.isSeller || (s.buyer_id !== null && s.buyer_id === ctx.user.id)
                ? s
                : { ...s, order_id: null },
        );

        return NextResponse.json({
            stream,
            items: items ?? [],
            spots: visibleSpots,
        });
    } catch (err: any) {
        console.error('[Live/Stream] GET error:', err);
        return NextResponse.json({ error: 'Failed to load stream' }, { status: 500 });
    }
}
