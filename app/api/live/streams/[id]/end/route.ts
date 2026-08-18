/**
 * POST /api/live/streams/[id]/end — flip live -> ended, stop the recording,
 * open the 30-day VOD retention window.
 *
 * The flip + egress stop live in lib/liveStreamLifecycle.ts because the
 * abandonment watchdog cron performs the same operation; see that module for
 * the ordering contract.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import { endLiveStream } from '@/lib/liveStreamLifecycle';

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

        let result;
        try {
            result = await endLiveStream(admin, stream);
        } catch (err: any) {
            console.error('[Live/End]', err?.message ?? err);
            return NextResponse.json({ error: 'Failed to end stream' }, { status: 500 });
        }

        if (!result.ended) {
            return NextResponse.json(
                { error: 'Stream state changed — reload and try again' },
                { status: 409 },
            );
        }

        // vod_url is filled asynchronously by app/api/webhooks/livekit
        // (egress_ended -> file location), which fires minutes after this
        // returns. Recording only happens at all when the LIVEKIT_EGRESS_S3_*
        // env vars are set — without them startRoomRecording skips and there
        // is no egress to complete. (Still open: a reaper to clear vod_url
        // once vod_expires_at passes.)

        return NextResponse.json({ success: true, vodExpiresAt: result.vodExpiresAt });
    } catch (err: any) {
        console.error('[Live/End] error:', err);
        return NextResponse.json({ error: 'Failed to end stream' }, { status: 500 });
    }
}
