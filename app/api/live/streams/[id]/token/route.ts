/**
 * POST /api/live/streams/[id]/token — LiveKit access tokens.
 *
 * body {role:'viewer'}    -> subscribe-only token (beta viewers; the seller
 *                            can also watch their own room).
 * body {role:'main_cam'}  -> publisher token for the FACE-cam slot (the
 *                            console in face-cam mode, or the QR-invited
 *                            phone when the console holds the table slot).
 * body {role:'table_cam'} -> publisher token for the TABLE slot (the console
 *                            in phone-as-table-cam mode, or the QR-invited
 *                            second device). The ':main'/':table' identity
 *                            suffix (lib/livekit.ts) lets both coexist.
 * body {role:'monitor'}   -> subscribe-only token for a MANAGE-ONLY console:
 *                            full controls + monitor tiles, no publish grant,
 *                            so opening it never prompts for (or displaces) a
 *                            camera. ':monitor' suffixed so it can't collide
 *                            with the seller's publisher/viewer identities.
 *
 * Broadcaster tokens (main_cam / table_cam / monitor) are minted while the
 * show is 'scheduled' OR 'live' — the broadcaster stages cameras and the
 * layout BEFORE going live. Staging is invisible to the audience: viewer
 * tokens stay gated on status='live', and the viewer page only attempts to
 * join a live show.
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

        if (role === 'main_cam' || role === 'table_cam') {
            const ctx = await requireBroadcaster(id);
            if (ctx instanceof NextResponse) return ctx;
            const { user, stream } = ctx;

            if (stream.status !== 'live' && stream.status !== 'scheduled') {
                return NextResponse.json(
                    { error: 'Stream has ended' },
                    { status: 409 },
                );
            }
            const slot = role === 'main_cam' ? 'main' : 'table';
            const room = stream.livekit_room || roomNameForStream(stream.id);
            const token = await mintPublisherToken(room, user.id, slot);
            // url: the wss:// signal host — clients (incl. the QR-launched
            // table-cam page) get it from here, never from their own env.
            return NextResponse.json({
                room,
                token,
                url: process.env.LIVEKIT_URL || null,
                cameraSlot: slot,
            });
        }

        if (role === 'monitor') {
            const ctx = await requireBroadcaster(id);
            if (ctx instanceof NextResponse) return ctx;
            const { user, stream } = ctx;

            if (stream.status !== 'live' && stream.status !== 'scheduled') {
                return NextResponse.json(
                    { error: 'Stream has ended' },
                    { status: 409 },
                );
            }
            const room = stream.livekit_room || roomNameForStream(stream.id);
            const token = await mintViewerToken(room, `${user.id}:monitor`);
            return NextResponse.json({
                room,
                token,
                url: process.env.LIVEKIT_URL || null,
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
            { error: "role must be 'viewer', 'main_cam', 'table_cam' or 'monitor'" },
            { status: 400 },
        );
    } catch (err: any) {
        console.error('[Live/Token] error:', err);
        return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 });
    }
}
