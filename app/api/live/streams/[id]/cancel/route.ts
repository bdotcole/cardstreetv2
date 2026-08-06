/**
 * POST /api/live/streams/[id]/cancel — scheduled -> cancelled.
 *
 * The show manager's cancel for a show that never ran. A LIVE show cannot be
 * cancelled — it must be ended (/end), which owns recording teardown and the
 * VOD window. Nothing here touches lots/spots: a scheduled show that sold
 * nothing has nothing to unwind, and selling starts only once live.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { stream } = ctx;

        // Idempotent: a retried tap on an already-cancelled show succeeds.
        if (stream.status === 'cancelled') {
            return NextResponse.json({ success: true, alreadyCancelled: true });
        }
        if (stream.status !== 'scheduled') {
            return NextResponse.json(
                { error: `Stream is ${stream.status} and cannot be cancelled` },
                { status: 409 },
            );
        }

        const admin = createAdminClient();
        const { data: flipped, error: flipErr } = await admin
            .from('streams')
            .update({ status: 'cancelled' })
            .eq('id', stream.id)
            .eq('status', 'scheduled')
            .select('id');

        if (flipErr) {
            console.error('[Live/Cancel] status flip failed:', flipErr.message);
            return NextResponse.json({ error: 'Failed to cancel stream' }, { status: 500 });
        }
        if (!flipped || flipped.length === 0) {
            return NextResponse.json(
                { error: 'Stream state changed — reload and try again' },
                { status: 409 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Live/Cancel] error:', err);
        return NextResponse.json({ error: 'Failed to cancel stream' }, { status: 500 });
    }
}
