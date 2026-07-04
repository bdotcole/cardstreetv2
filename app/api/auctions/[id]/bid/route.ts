/**
 * POST /api/auctions/[id]/bid  { maxBidSatang }
 *
 * The ONLY write path for bids. The route does the authz + policy gates; the
 * place_bid() RPC does ALL the money logic atomically under the auction row
 * lock (increment validation, proxy resolution, soft-close). The client never
 * computes price.
 *
 * Gates, in order:
 *   1. requireBeta('auctions') -- includes the global kill switch.
 *   2. Geo: a bid is a purchase commitment, so the TH-only purchase gate
 *      applies exactly like checkout (fail-open on unknown, lib/geo.ts).
 *   3. Complete buyer shipping profile -- a winner must be shippable; gating
 *      at bid time is what guarantees settlement can always create the order.
 *   4. Rate limit (fail-open, service-role RPC like /api/scan).
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
import { notifyOutbid } from '@/lib/auctionNotifications';

export const dynamic = 'force-dynamic';

const REASON_STATUS: Record<string, number> = {
    not_found: 404,
    ended: 409,
    own_auction: 400,
    suspended: 403,
    invalid_amount: 400,
    below_min: 409,
    not_above_own_max: 409,
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

    // ─── Geo gate (purchase commitment) ───
    const country = getRequestCountry(req);
    if (!isPurchaseAllowedFromCountry(country)) {
        return NextResponse.json(
            {
                error: 'Bidding is currently only available in Thailand.',
                code: 'GEO_RESTRICTED',
                country,
            },
            { status: 403 },
        );
    }

    const body = await req.json().catch(() => ({}));
    const maxBidSatang = Number(body?.maxBidSatang);
    if (!Number.isInteger(maxBidSatang) || maxBidSatang <= 0) {
        return NextResponse.json({ error: 'maxBidSatang must be a positive integer' }, { status: 400 });
    }

    const admin = createAdminClient();

    // ─── Shippable-winner gate ───
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

    // ─── Rate limit (fail-open like /api/scan) ───
    try {
        const { data: count } = await admin.rpc('bump_rate_limit', {
            p_key: `auction-bid:${user.id}:1m`,
            p_window_seconds: 60,
        });
        if (typeof count === 'number' && count > 20) {
            return NextResponse.json(
                { error: 'Too many bids — slow down a moment.', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }
    } catch { /* limiter failure never blocks a bid */ }

    // Pre-read the standing high bidder so we can tell them they were outbid.
    // Non-locking read; a race at worst mis-addresses one courtesy ping.
    const { data: pre } = await admin
        .from('auctions')
        .select('high_bidder_id, card_data')
        .eq('id', id)
        .maybeSingle();

    const { data: result, error } = await admin.rpc('place_bid', {
        p_auction_id: id,
        p_bidder_id: user.id,
        p_max_bid: maxBidSatang,
    });

    if (error) {
        console.error('[Auctions] place_bid RPC failed:', error);
        return NextResponse.json({ error: 'Bid failed — please retry' }, { status: 500 });
    }

    const outcome = result as {
        accepted: boolean;
        reason?: string | null;
        current_price?: number;
        is_high_bidder?: boolean;
    };

    if (!outcome?.accepted) {
        const status = REASON_STATUS[outcome?.reason ?? ''] ?? 400;
        return NextResponse.json({ ...outcome }, { status });
    }

    // Courtesy outbid ping to the displaced high bidder (never the caller).
    const displaced = pre?.high_bidder_id;
    if (
        outcome.is_high_bidder &&
        displaced &&
        displaced !== user.id
    ) {
        after(() =>
            notifyOutbid(displaced, {
                id,
                card_data: pre?.card_data,
                current_price: Number(outcome.current_price ?? 0),
            }).catch(() => { }),
        );
    }

    return NextResponse.json(outcome);
}
