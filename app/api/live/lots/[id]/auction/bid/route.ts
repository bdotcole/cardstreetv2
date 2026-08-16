/**
 * POST /api/live/lots/[id]/auction/bid — place a live bid. Body:
 * { amountSatang }, sent to place_bid as p_max_bid (the do-not-fork rule: the
 * timed engine runs unchanged with short timers). The quick-bid button always
 * sends the exact minimum next bid, so bidding degenerates to plain ascending;
 * a CUSTOM bid above the minimum behaves as an eBay proxy ceiling (displays at
 * the minimum, auto-defends up to the entered amount) — deliberate, and the
 * response's your_max says so.
 *
 * All arbitration — increments, soft-close extension, suspension, own-lot,
 * ended — lives in the place_bid RPC (SELECT ... FOR UPDATE, service-role
 * only). This route is the auth/geo/rate shell plus the room fan-out: every
 * accepted bid is pushed to the whole room over the stream's broadcast
 * channel (viewers can't read the auctions table — its RLS belongs to the
 * timed-auction beta — so the push, plus the detail GET's server-side
 * enrichment, IS their data path).
 *
 * A bid landing after the clock ran out (reason 'ended') opportunistically
 * hammers the auction so the room settles even if the console missed the
 * moment.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import {
    AUCTION_ENGINE_COLS,
    LOT_GUARD_COLS,
    announceAuctionClose,
    broadcastStreamEvent,
    closeLiveAuction,
    shapeAuctionState,
    type AuctionEngineRow,
    type LotRow,
} from '@/lib/liveBreaks';
import { autoChargeAuctionWin } from '@/lib/liveAuctionCharge';

const BID_WINDOW_SECONDS = 10;
const BID_MAX_PER_WINDOW = 15;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        // A bid is a purchase commitment — same TH-only gate as claims.
        const country = getRequestCountry(req);
        if (!isPurchaseAllowedFromCountry(country)) {
            return NextResponse.json(
                {
                    error:
                        'Purchases are currently only available in Thailand. ' +
                        'Buying is coming soon to your country.',
                    code: 'GEO_RESTRICTED',
                    country,
                },
                { status: 403 },
            );
        }

        const { allowed } = await checkRateLimit(`live-bid:${user.id}`, {
            windowSeconds: BID_WINDOW_SECONDS,
            max: BID_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Bidding too fast — slow down', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const amount = body?.amountSatang ?? body?.amount_satang;
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
            return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 });
        }

        const admin = createAdminClient();

        // Card on file is the ticket to bid (Whatnot model): the hammer
        // charges it off-session, so a cardless bid would be an empty
        // commitment. 402 tells the client to open the save-card sheet.
        const { data: bidderProfile } = await admin
            .from('profiles')
            .select('stripe_customer_id_th, live_default_payment_method')
            .eq('id', user.id)
            .maybeSingle<{
                stripe_customer_id_th: string | null;
                live_default_payment_method: string | null;
            }>();
        if (!bidderProfile?.stripe_customer_id_th || !bidderProfile.live_default_payment_method) {
            return NextResponse.json(
                {
                    error: 'Add a card to bid — the winning bid is charged automatically',
                    code: 'NEEDS_CARD',
                },
                { status: 402 },
            );
        }
        const { data: lot } = await admin
            .from('stream_items')
            .select(LOT_GUARD_COLS)
            .eq('id', id)
            .maybeSingle<LotRow>();
        // Whole-lot auctions and rip_till_hit turn auctions both bid here —
        // lot.auction_id always points at the CURRENT engine row.
        if (
            !lot ||
            (lot.item_type !== 'auction' && lot.item_type !== 'rip_till_hit') ||
            !lot.auction_id
        ) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const { data: stream } = await admin
            .from('streams')
            .select('id, status')
            .eq('id', lot.stream_id)
            .maybeSingle<{ id: string; status: string }>();
        if (!stream || stream.status !== 'live') {
            return NextResponse.json(
                { error: 'The show is not live', code: 'STREAM_NOT_LIVE' },
                { status: 409 },
            );
        }

        const { data, error } = await admin.rpc('place_bid', {
            p_auction_id: lot.auction_id,
            p_bidder_id: user.id,
            p_max_bid: amount,
        });
        if (error) {
            console.error('[Live/AuctionBid] RPC failed:', error.message);
            return NextResponse.json({ error: 'Failed to place bid' }, { status: 500 });
        }

        const result = (data ?? {}) as {
            accepted?: boolean;
            reason?: string | null;
            [key: string]: unknown;
        };

        if (result.accepted !== true) {
            // The clock ran out under this bid — settle the room now rather
            // than waiting on the console's tick.
            if (result.reason === 'ended') {
                const closed = await closeLiveAuction(lot);
                if (!('error' in closed) && closed.closed && closed.auction) {
                    let autoCharged = false;
                    if (closed.auction.status === 'sold' && closed.winnerHoldSet && closed.spotId) {
                        autoCharged = (
                            await autoChargeAuctionWin(lot, closed.auction, closed.spotId)
                        ).charged;
                    }
                    await announceAuctionClose(
                        stream.id,
                        lot,
                        closed.auction,
                        closed.winnerHoldSet,
                        closed.spotNumber,
                        autoCharged,
                    );
                }
            }
            return NextResponse.json(result, { status: 409 });
        }

        // Fan the accepted bid out to the room. The engine row re-read gives
        // the broadcast the same shape the detail GET serves.
        const { data: engineRow } = await admin
            .from('auctions')
            .select(AUCTION_ENGINE_COLS)
            .eq('id', lot.auction_id)
            .maybeSingle<AuctionEngineRow>();
        const state = engineRow ? await shapeAuctionState(engineRow) : null;
        if (state) {
            await broadcastStreamEvent(lot.stream_id, 'auction', {
                lotId: lot.id,
                auction: state,
                at: Date.now(),
            });
        }

        return NextResponse.json({ ...result, auction: state });
    } catch (err: any) {
        console.error('[Live/AuctionBid] error:', err);
        return NextResponse.json({ error: 'Failed to place bid' }, { status: 500 });
    }
}
