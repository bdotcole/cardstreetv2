/**
 * POST /api/auctions/[id]/buy-now
 *
 * Instant purchase at the Buy-It-Now price (only while the auction has no
 * bids -- the RPC enforces it). On success the auction is settled inline so
 * the response hands the client a payable transfer_group and it can go
 * straight into the existing payment flow (/api/checkout).
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBeta } from '@/lib/betaAuth';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation';
import { settleAuction } from '@/lib/auctionSettlement';
import { notifyAuctionSoldSeller } from '@/lib/auctionNotifications';

export const dynamic = 'force-dynamic';

const REASON_STATUS: Record<string, number> = {
    not_found: 404,
    ended: 409,
    no_buy_now: 400,
    bidding_started: 409,
    own_auction: 400,
    suspended: 403,
};

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const gate = await requireBeta('auctions');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'Missing auction id' }, { status: 400 });

    const country = getRequestCountry(req);
    if (!isPurchaseAllowedFromCountry(country)) {
        return NextResponse.json(
            { error: 'Buying is currently only available in Thailand.', code: 'GEO_RESTRICTED', country },
            { status: 403 },
        );
    }

    const admin = createAdminClient();

    const { data: buyerProfile } = await admin
        .from('profiles')
        .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
        .eq('id', user.id)
        .single<Record<string, string | null>>();
    const completeness = checkBuyerProfileComplete(buyerProfile ?? {});
    if (!completeness.complete) {
        return NextResponse.json(
            {
                error: BUYER_PROFILE_INCOMPLETE_TOAST,
                code: BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
                missing: completeness.missing,
            },
            { status: 400 },
        );
    }

    const { data: result, error } = await admin.rpc('buy_now', {
        p_auction_id: id,
        p_buyer_id: user.id,
    });

    if (error) {
        console.error('[Auctions] buy_now RPC failed:', error);
        return NextResponse.json({ error: 'Buy It Now failed — please retry' }, { status: 500 });
    }

    const outcome = result as { accepted: boolean; reason?: string };
    if (!outcome?.accepted) {
        const status = REASON_STATUS[outcome?.reason ?? ''] ?? 400;
        return NextResponse.json({ ...outcome }, { status });
    }

    // Settle inline: create the pending_payment order now so the buyer can pay
    // immediately. If settlement hiccups (e.g. Flash quote outage), the sweep
    // cron retries within a minute -- tell the client to check back.
    const settlement = await settleAuction(id);
    if (settlement.outcome !== 'settled' && settlement.outcome !== 'already_settled') {
        console.error('[Auctions] buy-now settlement deferred:', settlement);
        return NextResponse.json({
            accepted: true,
            pendingSettlement: true,
        });
    }

    after(async () => {
        const { data: auction } = await admin
            .from('auctions')
            .select('id, card_data, winning_amount')
            .eq('id', id)
            .maybeSingle();
        if (auction) await notifyAuctionSoldSeller(settlement.sellerId!, auction as any);
    });

    return NextResponse.json({
        accepted: true,
        orderId: settlement.orderId,
        transferGroup: settlement.transferGroup,
        totalAmount: settlement.totalAmount,
        paymentDueAt: settlement.paymentDueAt,
    });
}
