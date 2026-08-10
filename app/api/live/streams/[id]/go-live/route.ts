/**
 * POST /api/live/streams/[id]/go-live — flip scheduled -> live and hand the
 * console device its main-cam publisher token.
 *
 * The status flip is a CAS on 'scheduled' so a double-tap can't double-start
 * the recording. Recording itself is best-effort (see lib/livekit.ts) — a
 * missing egress config never blocks going live.
 *
 * A console that STAGED its cameras pre-live (token route, role 'main_cam')
 * is already connected as ':main' when it calls this — it ignores the token
 * in the response and just takes the status flip. The token return stays for
 * the un-staged console and for device-swap/crash reconnects.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import { mintPublisherToken, roomNameForStream, startRoomRecording } from '@/lib/livekit';
import { sendShowLiveNotification } from '@/lib/courier';

/**
 * Presale go-live fan-out: notify the distinct buyers of this stream's SOLD
 * spots that the show they reserved a seat in is starting. At flip time sold
 * spots can only be presale purchases, so this is precisely the presale
 * audience. Best-effort end to end — a notify failure must never block (or
 * fail) going live; skips are logged.
 */
async function notifyPresaleBuyers(
    admin: ReturnType<typeof createAdminClient>,
    streamId: string,
    sellerId: string,
): Promise<void> {
    try {
        const { data: soldSpots, error: soldErr } = await admin
            .from('break_spots')
            .select('buyer_id')
            .eq('stream_id', streamId)
            .eq('status', 'sold')
            .not('buyer_id', 'is', null);
        if (soldErr) {
            console.warn('[Live/GoLive] presale notify skipped — spot query failed:', soldErr.message);
            return;
        }
        const buyerIds = [...new Set((soldSpots ?? []).map(r => r.buyer_id as string))]
            .filter(id => id !== sellerId);
        if (buyerIds.length === 0) return;

        const { data: streamRow } = await admin
            .from('streams')
            .select('title')
            .eq('id', streamId)
            .maybeSingle<{ title: string }>();
        const title = streamRow?.title || 'Live break';

        const results = await Promise.allSettled(
            buyerIds.map(id => sendShowLiveNotification(id, { streamId, title })),
        );
        const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        console.log(`[Live/GoLive] presale notify: ${sent}/${buyerIds.length} dispatched for ${streamId}`);
    } catch (err) {
        console.warn('[Live/GoLive] presale notify skipped:', err);
    }
}

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        const admin = createAdminClient();
        const room = stream.livekit_room || roomNameForStream(stream.id);

        // Reconnect path: the console app crashed or the seller swapped
        // devices mid-show. Re-minting the main-cam token is safe — the same
        // identity resumes the slot — and must not re-flip anything.
        if (stream.status === 'live') {
            const token = await mintPublisherToken(room, user.id, 'main');
            return NextResponse.json({
                success: true,
                alreadyLive: true,
                room,
                token,
                // The wss:// signal URL the client connects to — the client
                // never carries its own LiveKit config.
                url: process.env.LIVEKIT_URL || null,
                cameraSlot: 'main',
                egressId: stream.livekit_egress_id,
            });
        }

        if (stream.status !== 'scheduled') {
            return NextResponse.json(
                { error: `Stream is ${stream.status} and cannot go live` },
                { status: 409 },
            );
        }

        const { data: flipped, error: flipErr } = await admin
            .from('streams')
            .update({
                status: 'live',
                started_at: new Date().toISOString(),
                livekit_room: room,
            })
            .eq('id', stream.id)
            .eq('status', 'scheduled')
            .select('id');

        if (flipErr) {
            console.error('[Live/GoLive] status flip failed:', flipErr.message);
            return NextResponse.json({ error: 'Failed to go live' }, { status: 500 });
        }
        if (!flipped || flipped.length === 0) {
            return NextResponse.json(
                { error: 'Stream state changed — reload and try again' },
                { status: 409 },
            );
        }

        const egressId = await startRoomRecording(room);
        if (egressId) {
            await admin
                .from('streams')
                .update({ livekit_egress_id: egressId })
                .eq('id', stream.id);
        }

        // After the flip only — never on the reconnect path above, so a
        // crashed-console rejoin can't re-notify every presale buyer.
        await notifyPresaleBuyers(admin, stream.id, user.id);

        const token = await mintPublisherToken(room, user.id, 'main');

        return NextResponse.json({
            success: true,
            room,
            token,
            url: process.env.LIVEKIT_URL || null,
            cameraSlot: 'main',
            egressId,
        });
    } catch (err: any) {
        console.error('[Live/GoLive] error:', err);
        return NextResponse.json({ error: 'Failed to go live' }, { status: 500 });
    }
}
