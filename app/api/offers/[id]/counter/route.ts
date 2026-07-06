/**
 * OBO Best-Offer — counter the newest pending offer with a new amount.
 *
 * Only the counterparty may counter. The two writes (parent -> countered, child
 * inserted pending) must be atomic, so this delegates to the counter_offer
 * Postgres RPC (SECURITY DEFINER, FOR UPDATE on the parent) defined in
 * 20260707_offers.sql. The RPC re-checks counterparty identity internally.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse, after } from 'next/server';
import { sendOfferCounteredNotification } from '@/lib/courier';
import { cardNameFromListingEmbed } from '@/lib/offerPolicy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { id } = await params;

    const cookieSupabase = await createServerClient();
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const amount: number | null =
        typeof body?.amount === 'number' && Number.isFinite(body.amount) && body.amount > 0 ? body.amount : null;
    if (amount === null) {
        return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Load the parent for notification routing before the transactional counter.
    const { data: parent } = await admin
        .from('offers')
        .select('id, listing_id, buyer_id, seller_id, actor_role, status, card_data:listings(card_data)')
        .eq('id', id)
        .single();
    if (!parent || parent.status !== 'pending') {
        return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
    }

    const { data: newId, error: rpcErr } = await admin.rpc('counter_offer', {
        p_offer_id: id,
        p_actor_id: user.id,
        p_amount: amount,
    });

    if (rpcErr) {
        const msg = rpcErr.message || '';
        if (msg.includes('offer_not_pending')) {
            return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
        }
        if (msg.includes('not_counterparty')) {
            return NextResponse.json({ error: 'Only the counterparty can counter this offer' }, { status: 403 });
        }
        console.error('[Offers/Counter] rpc failed:', rpcErr);
        return NextResponse.json({ error: 'Failed to counter offer' }, { status: 500 });
    }

    // Notify the offeror of the PARENT (the party whose offer was just countered).
    const offerorId = parent.actor_role === 'buyer' ? parent.buyer_id : parent.seller_id;
    const cardName = cardNameFromListingEmbed((parent as { card_data?: unknown }).card_data);
    after(() =>
        sendOfferCounteredNotification(offerorId, {
            offerId: parent.id,
            listingId: parent.listing_id,
            amount,
            cardName,
        }).catch((e) => console.error('[Offers/Counter] notify (non-fatal):', e)),
    );

    return NextResponse.json({ id: newId, status: 'pending', amount });
}
