/**
 * GET /api/auctions/[id] -- auction detail + bid history (beta-gated).
 *
 * Bid history is served from here with max_amount STRIPPED for everyone but
 * the row's own bidder -- proxy ceilings are secret (bids RLS enforces the
 * same for direct reads; this route uses service-role and re-implements the
 * redaction because it must also return rivals' visible amounts).
 *
 * Also returns the caller's standing (your current max, high-bidder flag,
 * min next bid) and serverNow for the countdown.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBeta } from '@/lib/betaAuth';
import { bidIncrementSatang, minNextBidSatang } from '@/lib/auctionRules';

export const dynamic = 'force-dynamic';

export async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const gate = await requireBeta('auctions');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'Missing auction id' }, { status: 400 });

    const admin = createAdminClient();

    const { data: auction, error } = await admin
        .from('auctions')
        .select(
            '*, seller:profiles!auctions_seller_id_fkey(id, display_name, avatar_url, rating, review_count), ' +
            'order:orders!auctions_order_id_fkey(id, status, transfer_group)',
        )
        .eq('id', id)
        .maybeSingle<Record<string, any>>();

    if (error) {
        console.error('[Auctions] detail failed:', error);
        return NextResponse.json({ error: 'Failed to load auction' }, { status: 500 });
    }
    if (!auction) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: bidRows } = await admin
        .from('bids')
        .select('id, bidder_id, amount, max_amount, is_proxy, created_at, seq, bidder:profiles!bids_bidder_id_fkey(display_name, avatar_url)')
        .eq('auction_id', id)
        .order('seq', { ascending: false })
        .limit(100)
        .returns<Record<string, any>[]>();

    // Redact rival maxima; keep the caller's own so the UI can show "your max".
    const bids = (bidRows ?? []).map((b) => ({
        id: b.id,
        bidder_id: b.bidder_id,
        bidder: b.bidder,
        amount: b.amount,
        is_proxy: b.is_proxy,
        created_at: b.created_at,
        max_amount: b.bidder_id === user.id ? b.max_amount : undefined,
    }));

    const yourMax = (bidRows ?? [])
        .filter((b) => b.bidder_id === user.id)
        .reduce((m, b) => Math.max(m, Number(b.max_amount)), 0);

    return NextResponse.json({
        auction,
        bids,
        you: {
            id: user.id,
            isSeller: auction.seller_id === user.id,
            isHighBidder: auction.high_bidder_id === user.id,
            isWinner: auction.winner_id === user.id,
            maxBid: yourMax > 0 ? yourMax : null,
            secondChanceOffer:
                auction.second_chance_status === 'offered' && auction.second_chance_offered_to === user.id
                    ? {
                        amount: auction.second_chance_amount,
                        expiresAt: auction.second_chance_expires_at,
                    }
                    : null,
        },
        minNextBid: minNextBidSatang(
            Number(auction.current_price),
            Number(auction.bid_count),
            Number(auction.starting_price),
        ),
        increment: bidIncrementSatang(Number(auction.current_price)),
        serverNow: new Date().toISOString(),
    });
}
