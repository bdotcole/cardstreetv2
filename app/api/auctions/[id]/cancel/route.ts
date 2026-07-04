/**
 * POST /api/auctions/[id]/cancel -- seller cancels a bid-free auction.
 * The RPC enforces ownership, live status, and zero bids atomically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBeta } from '@/lib/betaAuth';

export const dynamic = 'force-dynamic';

export async function POST(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const gate = await requireBeta('auctions');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'Missing auction id' }, { status: 400 });

    const admin = createAdminClient();
    const { data: result, error } = await admin.rpc('cancel_auction', {
        p_auction_id: id,
        p_seller_id: user.id,
    });

    if (error) {
        console.error('[Auctions] cancel RPC failed:', error);
        return NextResponse.json({ error: 'Cancel failed' }, { status: 500 });
    }

    const outcome = result as { accepted: boolean; reason?: string };
    if (!outcome?.accepted) {
        const status = outcome?.reason === 'not_found' ? 404 : 409;
        return NextResponse.json({ ...outcome }, { status });
    }
    return NextResponse.json(outcome);
}
