/**
 * OBO Best-Offer — accept the newest pending offer in a chain.
 *
 * Only the counterparty (the party who did NOT make the pending row) may
 * accept. Acceptance does NOT touch listings.status — there is no reserve; the
 * listing stays `active` and Buy-Now always wins the reservation CAS. The
 * accepted offer's buyer may then pay at `amount` via /api/orders/checkout
 * with acceptedOfferId.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse, after } from 'next/server';
import { sendOfferAcceptedNotification } from '@/lib/courier';
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

    // Counterparty of a buyer-made offer is the seller, and vice versa.
    const counterpartyId = offer.actor_role === 'buyer' ? offer.seller_id : offer.buyer_id;
    if (user.id !== counterpartyId) {
        return NextResponse.json({ error: 'Only the counterparty can accept this offer' }, { status: 403 });
    }

    // CAS: accept only if still pending (a concurrent withdraw/counter/expire may have won).
    const { data: won } = await admin
        .from('offers')
        .update({ status: 'accepted' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id');
    if (!won || won.length !== 1) {
        return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
    }

    // Notify the offer's buyer (whoever will pay).
    const cardName = cardNameFromListingEmbed((offer as { card_data?: unknown }).card_data);
    after(() =>
        sendOfferAcceptedNotification(offer.buyer_id, {
            offerId: offer.id,
            listingId: offer.listing_id,
            amount: offer.amount,
            cardName,
        }).catch((e) => console.error('[Offers/Accept] notify (non-fatal):', e)),
    );

    return NextResponse.json({ id: offer.id, status: 'accepted', amount: offer.amount, listing_id: offer.listing_id });
}
