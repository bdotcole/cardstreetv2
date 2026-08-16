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
import { autoChargeAuctionWin } from '@/lib/liveAuctionCharge';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { lot, stream } = ctx;

        if ((lot.item_type !== 'auction' && lot.item_type !== 'rip_till_hit') || !lot.auction_id) {
            return NextResponse.json({ error: 'Not an auction lot' }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));
        const force = body?.force === true;

        const result = await closeLiveAuction(lot, { force });
        if ('error' in result) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }

        if (result.closed && result.auction) {
            // Whatnot model: the winner's saved card is charged at the hammer.
            // Any failure keeps the checkout hold — the manual Spots-bar flow
            // is the universal fallback, and the announcement says which.
            let autoCharged = false;
            if (result.auction.status === 'sold' && result.winnerHoldSet && result.spotId) {
                autoCharged = (
                    await autoChargeAuctionWin(lot, result.auction, result.spotId)
                ).charged;
            }
            await announceAuctionClose(
                stream.id,
                lot,
                result.auction,
                result.winnerHoldSet,
                result.spotNumber,
                autoCharged,
            );
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
