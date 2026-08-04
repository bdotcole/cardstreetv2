/**
 * POST /api/live/streams/[id]/end — flip live -> ended, stop the recording,
 * open the 30-day VOD retention window.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import { stopRoomRecording } from '@/lib/livekit';

const VOD_RETENTION_DAYS = 30;

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { stream } = ctx;

        // Idempotent: a retried tap on an already-ended stream is a success,
        // not an error.
        if (stream.status === 'ended') {
            return NextResponse.json({ success: true, alreadyEnded: true });
        }
        if (stream.status !== 'live') {
            return NextResponse.json(
                { error: `Stream is ${stream.status} and cannot be ended` },
                { status: 409 },
            );
        }

        const admin = createAdminClient();
        const now = new Date();
        const vodExpiresAt = new Date(
            now.getTime() + VOD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

        const { data: flipped, error: flipErr } = await admin
            .from('streams')
            .update({
                status: 'ended',
                ended_at: now.toISOString(),
                vod_expires_at: vodExpiresAt,
            })
            .eq('id', stream.id)
            .eq('status', 'live')
            .select('id');

        if (flipErr) {
            console.error('[Live/End] status flip failed:', flipErr.message);
            return NextResponse.json({ error: 'Failed to end stream' }, { status: 500 });
        }
        if (!flipped || flipped.length === 0) {
            return NextResponse.json(
                { error: 'Stream state changed — reload and try again' },
                { status: 409 },
            );
        }

        // Best-effort; a finished/failed egress erroring on stop must not fail
        // the end call.
        if (stream.livekit_egress_id) {
            await stopRoomRecording(stream.livekit_egress_id);
        }

        // TODO: vod_url is filled asynchronously when the egress completes —
        // wire the LiveKit egress webhook (egress_ended -> file location) to
        // stamp streams.vod_url, and a reaper to clear it after vod_expires_at.

        return NextResponse.json({ success: true, vodExpiresAt });
    } catch (err: any) {
        console.error('[Live/End] error:', err);
        return NextResponse.json({ error: err.message || 'Failed to end stream' }, { status: 500 });
    }
}
