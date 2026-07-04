/**
 * POST /api/auctions/sweep -- the auction lifecycle tick.
 *
 * Called every minute by the close-auctions Supabase Edge Function (itself
 * fired by pg_cron, wired like release-funds). CRON_SECRET bearer auth, same
 * as /api/cron/mirror-images. Idempotent throughout: every state transition
 * is an RPC with FOR UPDATE + CAS semantics, and settlement retries until the
 * order attach sticks.
 *
 * Passes:
 *   1. close_due_auctions()          -- live past ends_at → sold / unsold
 *   2. settle                        -- sold + orderless → synthetic listing +
 *                                       pending_payment order (24h window)
 *   3. void_overdue_auction_orders() -- deadbeats → void + strike + second chance
 *   4. expire_second_chance_offers() -- lapsed offers → unsold
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { settleAuction } from '@/lib/auctionSettlement';
import {
    notifyAuctionWon,
    notifyAuctionSoldSeller,
    notifyAuctionUnsold,
    notifyStrike,
    notifySecondChanceOffer,
} from '@/lib/auctionNotifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const summary = {
        closed_sold: 0,
        closed_unsold: 0,
        settled: 0,
        settle_failures: 0,
        voided: 0,
        second_chances: 0,
        offers_expired: 0,
        errors: [] as string[],
    };

    // ─── 1. Close due auctions ───
    try {
        const { data: closed, error } = await admin.rpc('close_due_auctions', { p_limit: 100 });
        if (error) throw error;
        for (const row of (closed ?? []) as any[]) {
            if (row.sold) {
                summary.closed_sold++;
                const { data: auction } = await admin
                    .from('auctions')
                    .select('id, card_data, winning_amount')
                    .eq('id', row.auction_id)
                    .maybeSingle();
                if (auction) await notifyAuctionSoldSeller(row.seller_id, auction as any);
            } else {
                summary.closed_unsold++;
                const { data: auction } = await admin
                    .from('auctions')
                    .select('id, card_data')
                    .eq('id', row.auction_id)
                    .maybeSingle();
                if (auction) {
                    await notifyAuctionUnsold(
                        row.seller_id,
                        auction as any,
                        row.reserve_not_met ? 'reserve_not_met' : 'no_bids',
                    );
                }
            }
        }
    } catch (err: any) {
        console.error('[AuctionSweep] close pass failed:', err);
        summary.errors.push(`close: ${err?.message}`);
    }

    // ─── 2. Settle sold-but-orderless auctions (covers fresh closes, accepted
    //        second chances, and any settlement that failed a prior tick) ───
    try {
        const { data: pending, error } = await admin
            .from('auctions')
            .select('id, winner_id, card_data, winning_amount, second_chance_status')
            .eq('status', 'sold')
            .is('order_id', null)
            .or('second_chance_status.is.null,second_chance_status.eq.accepted')
            .limit(100);
        if (error) throw error;

        for (const a of pending ?? []) {
            const res = await settleAuction(a.id);
            if (res.outcome === 'settled') {
                summary.settled++;
                await notifyAuctionWon(
                    res.winnerId!,
                    { id: a.id, card_data: a.card_data, winning_amount: Number(a.winning_amount) },
                    res.totalAmount!,
                    res.paymentDueAt!,
                );
            } else if (res.outcome !== 'already_settled' && res.outcome !== 'not_ready') {
                summary.settle_failures++;
                if (res.error) summary.errors.push(`settle ${a.id}: ${res.error}`);
            }
        }
    } catch (err: any) {
        console.error('[AuctionSweep] settle pass failed:', err);
        summary.errors.push(`settle: ${err?.message}`);
    }

    // ─── 3. Deadbeat sweep ───
    try {
        const { data: voided, error } = await admin.rpc('void_overdue_auction_orders', { p_limit: 50 });
        if (error) throw error;
        for (const row of (voided ?? []) as any[]) {
            summary.voided++;
            const { data: auction } = await admin
                .from('auctions')
                .select('id, card_data, second_chance_amount, second_chance_expires_at')
                .eq('id', row.auction_id)
                .maybeSingle();
            if (!auction) continue;

            await notifyStrike(row.deadbeat_id, auction as any);
            if (row.second_chance_offered && row.runner_up_id) {
                summary.second_chances++;
                await notifySecondChanceOffer(row.runner_up_id, auction as any);
            } else {
                await notifyAuctionUnsold(row.seller_id, auction as any, 'deadbeat');
            }
        }
    } catch (err: any) {
        console.error('[AuctionSweep] void pass failed:', err);
        summary.errors.push(`void: ${err?.message}`);
    }

    // ─── 4. Expire lapsed second-chance offers ───
    try {
        const { data: expired, error } = await admin.rpc('expire_second_chance_offers', { p_limit: 50 });
        if (error) throw error;
        for (const row of (expired ?? []) as any[]) {
            summary.offers_expired++;
            const { data: auction } = await admin
                .from('auctions')
                .select('id, card_data')
                .eq('id', row.auction_id)
                .maybeSingle();
            if (auction) await notifyAuctionUnsold(row.seller_id, auction as any, 'offer_lapsed');
        }
    } catch (err: any) {
        console.error('[AuctionSweep] expire pass failed:', err);
        summary.errors.push(`expire: ${err?.message}`);
    }

    return NextResponse.json({ success: summary.errors.length === 0, ...summary });
}
