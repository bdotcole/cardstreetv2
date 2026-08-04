/**
 * POST /api/live/streams/[id]/go-live — flip scheduled -> live and hand the
 * console device its main-cam publisher token.
 *
 * The status flip is a CAS on 'scheduled' so a double-tap can't double-start
 * the recording. Recording itself is best-effort (see lib/livekit.ts) — a
 * missing egress config never blocks going live.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import { mintPublisherToken, roomNameForStream, startRoomRecording } from '@/lib/livekit';

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
        return NextResponse.json({ error: err.message || 'Failed to go live' }, { status: 500 });
    }
}
