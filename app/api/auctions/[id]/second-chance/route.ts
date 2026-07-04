/**
 * POST /api/auctions/[id]/second-chance  { action: 'accept' | 'decline' }
 *
 * The runner-up's one-click response to a second-chance offer (made after a
 * deadbeat void, at the runner-up's own max bid). Accepting flips the winner
 * fields in the RPC and settles inline so the response is immediately payable
 * through the existing checkout.
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
import { notifyAuctionSoldSeller, notifyAuctionUnsold } from '@/lib/auctionNotifications';

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const gate = await requireBeta('auctions');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'Missing auction id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'decline' ? 'decline' : body?.action === 'accept' ? 'accept' : null;
    if (!action) {
        return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
    }

    const admin = createAdminClient();

    if (action === 'decline') {
        const { data: result, error } = await admin.rpc('decline_second_chance', {
            p_auction_id: id,
            p_user_id: user.id,
        });
        if (error) {
            console.error('[Auctions] decline_second_chance failed:', error);
            return NextResponse.json({ error: 'Decline failed' }, { status: 500 });
        }
        const outcome = result as { accepted: boolean; reason?: string };
        if (!outcome?.accepted) return NextResponse.json({ ...outcome }, { status: 409 });

        after(async () => {
            const { data: auction } = await admin
                .from('auctions')
                .select('id, seller_id, card_data')
                .eq('id', id)
                .maybeSingle();
            if (auction) await notifyAuctionUnsold(auction.seller_id, auction as any, 'offer_lapsed');
        });
        return NextResponse.json(outcome);
    }

    // ── Accept: same purchase gates as bidding ──
    const country = getRequestCountry(req);
    if (!isPurchaseAllowedFromCountry(country)) {
        return NextResponse.json(
            { error: 'Buying is currently only available in Thailand.', code: 'GEO_RESTRICTED', country },
            { status: 403 },
        );
    }

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

    const { data: result, error } = await admin.rpc('accept_second_chance', {
        p_auction_id: id,
        p_user_id: user.id,
    });
    if (error) {
        console.error('[Auctions] accept_second_chance failed:', error);
        return NextResponse.json({ error: 'Accept failed' }, { status: 500 });
    }
    const outcome = result as { accepted: boolean; reason?: string };
    if (!outcome?.accepted) {
        const status = outcome?.reason === 'expired' ? 410 : outcome?.reason === 'suspended' ? 403 : 409;
        return NextResponse.json({ ...outcome }, { status });
    }

    const settlement = await settleAuction(id);
    if (settlement.outcome !== 'settled' && settlement.outcome !== 'already_settled') {
        console.error('[Auctions] second-chance settlement deferred:', settlement);
        return NextResponse.json({ accepted: true, pendingSettlement: true });
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
