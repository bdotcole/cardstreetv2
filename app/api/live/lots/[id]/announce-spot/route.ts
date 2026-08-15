/**
 * POST /api/live/lots/[id]/announce-spot — the breaker calls out the spot
 * being opened RIGHT NOW. Body: { spotId }.
 *
 * Two deliveries, so the moment reaches everyone: a system chat line
 * ("Now opening: Spot #4 — Somchai") that persists for late joiners, and a
 * 'spot_focus' broadcast the viewer renders as a banner over the video (and
 * the console mirrors as the highlighted tile). This is how a breaker runs
 * the rip order out loud without touching the camera.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    broadcastStreamEvent,
    postSystemChat,
    requireLotBroadcaster,
} from '@/lib/liveBreaks';

interface AnnounceSpotRow {
    id: string;
    stream_item_id: string;
    spot_number: number;
    status: string;
    buyer_id: string | null;
    assigned_packs: number[] | null;
    assigned_entity?: string | null;
}

const SPOT_COLS = 'id, stream_item_id, spot_number, status, buyer_id, assigned_packs';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, lot, stream } = ctx;

        const body = await req.json().catch(() => ({}));
        const spotId = typeof body?.spotId === 'string' ? body.spotId : body?.spot_id;
        if (typeof spotId !== 'string' || !spotId) {
            return NextResponse.json({ error: 'spotId is required' }, { status: 400 });
        }

        const admin = createAdminClient();
        let { data: spot, error: spotErr } = await admin
            .from('break_spots')
            .select(`${SPOT_COLS}, assigned_entity`)
            .eq('id', spotId)
            .eq('stream_item_id', lot.id)
            .maybeSingle<AnnounceSpotRow>();
        // assigned_entity is additive (20260813) — retry without it pre-migration.
        if (spotErr && spotErr.code === '42703') {
            ({ data: spot, error: spotErr } = await admin
                .from('break_spots')
                .select(SPOT_COLS)
                .eq('id', spotId)
                .eq('stream_item_id', lot.id)
                .maybeSingle<AnnounceSpotRow>());
        }
        if (spotErr) {
            console.error('[Live/AnnounceSpot] spot fetch failed:', spotErr.message);
            return NextResponse.json({ error: 'Failed to announce spot' }, { status: 500 });
        }
        if (!spot) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        let buyerName: string | null = null;
        if (spot.buyer_id) {
            const { data: p } = await admin
                .from('profiles')
                .select('display_name')
                .eq('id', spot.buyer_id)
                .maybeSingle<{ display_name: string | null }>();
            buyerName = p?.display_name ?? null;
        }

        const packs = spot.assigned_packs && spot.assigned_packs.length > 0 ? spot.assigned_packs : null;
        const entity = spot.assigned_entity ?? null;
        const detail = entity
            ? ` (${entity})`
            : packs
                ? ` (pack${packs.length > 1 ? 's' : ''} ${packs.join(', ')})`
                : '';
        await postSystemChat(
            stream.id,
            user.id,
            `Now opening: Spot #${spot.spot_number}${buyerName ? ` — ${buyerName}` : ''}${detail}`,
        );
        await broadcastStreamEvent(stream.id, 'spot_focus', {
            lotId: lot.id,
            spotNumber: spot.spot_number,
            buyerName,
            packs,
            entity,
            at: Date.now(),
        });

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Live/AnnounceSpot] error:', err);
        return NextResponse.json({ error: 'Failed to announce spot' }, { status: 500 });
    }
}
