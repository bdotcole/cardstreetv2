/**
 * POST /api/live/streams/[id]/token — LiveKit access tokens.
 *
 * body {role:'viewer'}    -> subscribe-only token (beta viewers; the seller
 *                            can also watch their own room).
 * body {role:'table_cam'} -> the SECOND publisher token for the broadcaster's
 *                            overhead/table device. The main-cam token comes
 *                            from go-live; the ':main'/':table' identity
 *                            suffix (lib/livekit.ts) lets both coexist.
 */

import { NextResponse } from 'next/server';
import { requireBroadcaster, requireViewerOrSeller } from '@/lib/liveBreaks';
import { mintPublisherToken, mintViewerToken, roomNameForStream } from '@/lib/livekit';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const body = await req.json().catch(() => ({}));
        const role = body?.role;

        if (role === 'table_cam') {
            const ctx = await requireBroadcaster(id);
            if (ctx instanceof NextResponse) return ctx;
            const { user, stream } = ctx;

            if (stream.status !== 'live') {
                return NextResponse.json(
                    { error: 'Stream is not live' },
                    { status: 409 },
                );
            }
            const room = stream.livekit_room || roomNameForStream(stream.id);
            const token = await mintPublisherToken(room, user.id, 'table');
            // url: the wss:// signal host — clients (incl. the QR-launched
            // table-cam page) get it from here, never from their own env.
            return NextResponse.json({
                room,
                token,
                url: process.env.LIVEKIT_URL || null,
                cameraSlot: 'table',
            });
        }

        if (role === 'viewer') {
            const ctx = await requireViewerOrSeller(id);
            if (ctx instanceof NextResponse) return ctx;
            const { user, stream } = ctx;

            if (stream.status !== 'live') {
                return NextResponse.json(
                    { error: 'Stream is not live' },
                    { status: 409 },
                );
            }
            const room = stream.livekit_room || roomNameForStream(stream.id);
            const token = await mintViewerToken(room, user.id);
            return NextResponse.json({
                room,
                token,
                url: process.env.LIVEKIT_URL || null,
            });
        }

        return NextResponse.json(
            { error: "role must be 'viewer' or 'table_cam'" },
            { status: 400 },
        );
    } catch (err: any) {
        console.error('[Live/Token] error:', err);
        return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 });
    }
}
