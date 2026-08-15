/**
 * POST /api/live/lots/[id]/auction/close — hammer a live auction. Body:
 * { force?: boolean } — force = the breaker's early "going twice... SOLD"
 * (skips the clock check); without it the call is the console's due-tick and
 * no-ops with { closed: false } while time remains.
 *
 * Broadcaster-only. Idempotent: an already-settled auction reports its state
 * instead of erroring, so the console's timer and a manual tap can race
 * safely. On a sold close the winner's checkout hold is set and the room is
 * told (system chat + broadcast) — see closeLiveAuction.
 */

import { NextResponse } from 'next/server';
import {
    announceAuctionClose,
    closeLiveAuction,
    requireLotBroadcaster,
    shapeAuctionState,
} from '@/lib/liveBreaks';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { lot, stream } = ctx;

        if (lot.item_type !== 'auction' || !lot.auction_id) {
            return NextResponse.json({ error: 'Not an auction lot' }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));
        const force = body?.force === true;

        const result = await closeLiveAuction(lot, { force });
        if ('error' in result) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }

        if (result.closed && result.auction) {
            await announceAuctionClose(stream.id, lot, result.auction, result.winnerHoldSet);
        }

        return NextResponse.json({
            closed: result.closed,
            status: result.status,
            auction: result.auction ? await shapeAuctionState(result.auction) : null,
        });
    } catch (err: any) {
        console.error('[Live/AuctionClose] error:', err);
        return NextResponse.json({ error: 'Failed to close auction' }, { status: 500 });
    }
}
