/**
 * POST /api/live/lots/[id]/auction/start — put an auction lot on the block.
 *
 * Mints the auctions engine row (mode='live', 10s/+10s sudden death, clock
 * from the lot's stored duration), links it onto the lot, marks the lot
 * active + current, and announces in chat. Restart after an UNSOLD close is
 * allowed (fresh auctions row, same lot/spot); a sold auction is final.
 *
 * The engine (place_bid & friends) is the timed auction house's, already in
 * prod and service-role-only — live mode reuses it unchanged per the
 * do-not-fork rule; only the timers differ.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    AUCTION_ENGINE_COLS,
    LIVE_AUCTION_MAX_SECONDS,
    LIVE_AUCTION_MIN_SECONDS,
    LIVE_SOFT_CLOSE_EXTENSION_SECONDS,
    LIVE_SOFT_CLOSE_WINDOW_SECONDS,
    broadcastStreamEvent,
    postSystemChat,
    requireLotBroadcaster,
    shapeAuctionState,
    type AuctionEngineRow,
} from '@/lib/liveBreaks';
import {
    formatSatang,
    nextTurnSpot,
    rtyhPricingOf,
    type LiveSpotRow,
} from '@/components/live/shared';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, lot, stream } = ctx;

        // Whole-lot auctions, or rip_till_hit lots in auction pricing mode
        // (each TURN is its own engine run on the same lot).
        const isTurnAuction = lot.item_type === 'rip_till_hit';
        if (lot.item_type !== 'auction' && !(isTurnAuction && rtyhPricingOf(lot) === 'auction')) {
            return NextResponse.json({ error: 'Not an auction lot' }, { status: 400 });
        }
        if (stream.status !== 'live') {
            return NextResponse.json(
                { error: 'The show must be live to start an auction', code: 'STREAM_NOT_LIVE' },
                { status: 409 },
            );
        }
        if (lot.status !== 'queued' && lot.status !== 'active') {
            return NextResponse.json({ error: 'Lot is closed' }, { status: 409 });
        }

        const admin = createAdminClient();

        // A previous run must be settled before another can start. A SOLD
        // outcome is final for a whole-lot auction, but for turn auctions it
        // just means the last turn found its buyer — the next turn may run.
        if (lot.auction_id) {
            const { data: prev } = await admin
                .from('auctions')
                .select('id, status')
                .eq('id', lot.auction_id)
                .maybeSingle<{ id: string; status: string }>();
            if (prev && prev.status === 'live') {
                return NextResponse.json(
                    { error: 'The auction is already running', code: 'ALREADY_LIVE' },
                    { status: 409 },
                );
            }
            if (!isTurnAuction && prev && prev.status === 'sold') {
                return NextResponse.json(
                    { error: 'This lot already sold at auction', code: 'ALREADY_SOLD' },
                    { status: 409 },
                );
            }
        }

        // Resolve the spot this run sells: the whole-lot auction's single
        // spot, or the next eligible TURN (lowest available with every lower
        // turn sold — the same sequencing the claim route enforces).
        const { data: spotRows } = await admin
            .from('break_spots')
            .select('id, stream_item_id, spot_number, price, status, held_by, hold_expires_at, buyer_id, order_id, sold_at, assigned_packs')
            .eq('stream_item_id', lot.id)
            .order('spot_number', { ascending: true })
            .returns<LiveSpotRow[]>();
        const now = Date.now();
        const spot = isTurnAuction
            ? nextTurnSpot(spotRows ?? [], now)
            : (spotRows ?? [])[0] ?? null;
        if (!spot) {
            if (!isTurnAuction) {
                return NextResponse.json({ error: 'Auction spot missing' }, { status: 500 });
            }
            const anyLeft = (spotRows ?? []).some((s) => s.status !== 'sold' && s.status !== 'cancelled');
            return NextResponse.json(
                anyLeft
                    ? {
                          error: "A buyer's payment window is still open — wait for it to finish",
                          code: 'WINNER_PAYING',
                      }
                    : { error: 'All turns are sold', code: 'ALREADY_SOLD' },
                { status: 409 },
            );
        }
        if (spot.status === 'sold') {
            return NextResponse.json(
                { error: 'This lot already sold at auction', code: 'ALREADY_SOLD' },
                { status: 409 },
            );
        }
        if (
            spot.status === 'held' &&
            spot.hold_expires_at &&
            Date.parse(spot.hold_expires_at) > now
        ) {
            return NextResponse.json(
                { error: "The previous winner's payment window is still open", code: 'WINNER_PAYING' },
                { status: 409 },
            );
        }
        // A lapsed winner hold reverts to open so the rerun starts clean.
        if (spot.status === 'held') {
            await admin
                .from('break_spots')
                .update({ status: 'open', held_by: null, hold_expires_at: null })
                .eq('id', spot.id)
                .eq('status', 'held');
        }

        const startingPrice = lot.spot_price;
        if (!startingPrice || startingPrice < 100) {
            return NextResponse.json({ error: 'Lot has no starting price' }, { status: 500 });
        }
        const rawDuration = (lot.card_data as { auctionDurationSeconds?: unknown } | null)
            ?.auctionDurationSeconds;
        const durationSeconds =
            typeof rawDuration === 'number' &&
            Number.isInteger(rawDuration) &&
            rawDuration >= LIVE_AUCTION_MIN_SECONDS &&
            rawDuration <= LIVE_AUCTION_MAX_SECONDS
                ? rawDuration
                : 60;

        const nowMs = Date.now();
        const endsAt = new Date(nowMs + durationSeconds * 1000).toISOString();
        const baseName =
            typeof (lot.card_data as { name?: unknown } | null)?.name === 'string'
                ? ((lot.card_data as { name: string }).name)
                : 'Auction lot';
        const cardName = isTurnAuction ? `${baseName} — Turn #${spot.spot_number}` : baseName;

        const { data: auction, error: insErr } = await admin
            .from('auctions')
            .insert({
                seller_id: user.id,
                // Turn auctions pin THEIR spot so the hammer can't grab a
                // sibling turn; whole-lot auctions own the lot's single spot.
                card_id: isTurnAuction ? `stream-spot:${spot.id}` : `stream-lot:${lot.id}`,
                card_data: lot.card_data ?? { name: cardName },
                condition: 'Sealed',
                starting_price: startingPrice,
                current_price: startingPrice,
                status: 'live',
                ends_at: endsAt,
                original_ends_at: endsAt,
                mode: 'live',
                soft_close_window_seconds: LIVE_SOFT_CLOSE_WINDOW_SECONDS,
                soft_close_extension_seconds: LIVE_SOFT_CLOSE_EXTENSION_SECONDS,
            })
            .select(AUCTION_ENGINE_COLS)
            .single<AuctionEngineRow>();
        if (insErr || !auction) {
            console.error('[Live/AuctionStart] insert failed:', insErr?.message);
            return NextResponse.json({ error: 'Failed to start auction' }, { status: 500 });
        }

        // Link + activate. CAS on the auction_id we read above: a concurrent
        // start that already re-linked the lot zeroes the match, and our
        // freshly minted engine row is rolled back instead of leaking as an
        // orphan 'live' auction.
        let link = admin
            .from('stream_items')
            .update({ auction_id: auction.id, status: 'active' })
            .eq('id', lot.id)
            .in('status', ['queued', 'active']);
        link = lot.auction_id === null ? link.is('auction_id', null) : link.eq('auction_id', lot.auction_id);
        const { data: linked, error: linkErr } = await link.select('id').maybeSingle<{ id: string }>();
        if (linkErr || !linked) {
            if (linkErr) console.error('[Live/AuctionStart] link failed:', linkErr.message);
            await admin.from('auctions').delete().eq('id', auction.id);
            return NextResponse.json(
                { error: 'Failed to start auction', code: linkErr ? undefined : 'ALREADY_LIVE' },
                { status: linkErr ? 500 : 409 },
            );
        }

        await admin
            .from('streams')
            .update({ current_item_id: lot.id })
            .eq('id', stream.id);

        const state = await shapeAuctionState(auction);
        await postSystemChat(
            stream.id,
            user.id,
            `Auction started: ${cardName} — bidding opens at ${formatSatang(startingPrice)}`,
        );
        await broadcastStreamEvent(stream.id, 'auction', {
            lotId: lot.id,
            auction: state,
            at: nowMs,
        });

        return NextResponse.json({ success: true, auction: state });
    } catch (err: any) {
        console.error('[Live/AuctionStart] error:', err);
        return NextResponse.json({ error: 'Failed to start auction' }, { status: 500 });
    }
}
