/**
 * OBO Best-Offer — reject the newest pending offer.
 *
 * Only the counterparty may reject. CAS pending -> rejected. The rejected row's
 * updated_at (maintained by trg_offers_touch) is the post-reject cooldown anchor
 * (see the create route's OFFER_COOLDOWN gate).
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse, after } from 'next/server';
import { sendOfferRejectedNotification } from '@/lib/courier';
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

    const admin = createAdminClient();

    const { data: offer } = await admin
        .from('offers')
        .select('id, listing_id, buyer_id, seller_id, actor_role, amount, status, card_data:listings(card_data)')
        .eq('id', id)
        .single();

    if (!offer || offer.status !== 'pending') {
        return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
    }

    const counterpartyId = offer.actor_role === 'buyer' ? offer.seller_id : offer.buyer_id;
    if (user.id !== counterpartyId) {
        return NextResponse.json({ error: 'Only the counterparty can reject this offer' }, { status: 403 });
    }

    const { data: won } = await admin
        .from('offers')
        .update({ status: 'rejected' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id');
    if (!won || won.length !== 1) {
        return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
    }

    // Notify the offeror (the party who made the pending row).
    const offerorId = offer.actor_role === 'buyer' ? offer.buyer_id : offer.seller_id;
    const cardName = cardNameFromListingEmbed((offer as { card_data?: unknown }).card_data);
    after(() =>
        sendOfferRejectedNotification(offerorId, {
            offerId: offer.id,
            listingId: offer.listing_id,
            amount: offer.amount,
            cardName,
        }).catch((e) => console.error('[Offers/Reject] notify (non-fatal):', e)),
    );

    return NextResponse.json({ id: offer.id, status: 'rejected' });
}
