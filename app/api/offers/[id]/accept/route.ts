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
import { sendOfferAcceptedNotification, sendOfferCounterAcceptedNotification } from '@/lib/courier';
import { ACCEPTED_PAY_WINDOW_MS, cardNameFromListingEmbed, isListingGone } from '@/lib/offerPolicy';
import { awardEvent } from '@/lib/rewards';
import { EARN } from '@/lib/rewardTiers';

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
        .select('id, listing_id, buyer_id, seller_id, actor_role, amount, status, card_data:listings(card_data, status)')
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

    // A seller can take a listing down with offers still open on it. Accepting
    // one would agree a price nobody can pay, and send the buyer to a payment
    // sheet that refuses.
    const listingEmbed = (offer as { card_data?: unknown }).card_data;
    const listingRow = (Array.isArray(listingEmbed) ? listingEmbed[0] : listingEmbed) as { status?: string } | null | undefined;
    if (isListingGone(listingRow?.status)) {
        return NextResponse.json({ error: 'This listing is no longer available' }, { status: 409 });
    }

    // CAS: accept only if still pending (a concurrent withdraw/counter/expire may have won).
    // expires_at restarts here: the buyer has 48 hours to pay from acceptance,
    // and the expiry cron reads it. It cannot read updated_at, which the
    // payment reminder's own write resets.
    const { data: won } = await admin
        .from('offers')
        .update({ status: 'accepted', expires_at: new Date(Date.now() + ACCEPTED_PAY_WINDOW_MS).toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id');
    if (!won || won.length !== 1) {
        return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
    }

    // Collector Pass: seller XP when an offer on their listing is accepted —
    // a counterparty action, deliberately never awarded on offer creation
    // (creating offers is free and reversible). Fail-soft, once per offer.
    await awardEvent(admin, {
        userId: offer.seller_id,
        rule: EARN.OFFER_ACCEPTED.rule,
        ref: offer.id,
        xp: EARN.OFFER_ACCEPTED.xp,
        coins: 0,
        dailyCap: EARN.OFFER_ACCEPTED.dailyCap,
    });

    // Tell the party who did NOT just tap Accept. When the seller accepts, that
    // is the buyer, who now has to pay. When the buyer accepts the seller's
    // counter, the app has already put them on the payment sheet (OffersInbox),
    // so the news goes to the seller instead — previously the buyer got a "your
    // offer was accepted" mail about their own tap and the seller heard nothing,
    // so had no reason to chase payment.
    const cardName = cardNameFromListingEmbed((offer as { card_data?: unknown }).card_data);
    const details = { offerId: offer.id, listingId: offer.listing_id, amount: offer.amount, cardName };
    after(() =>
        (offer.actor_role === 'seller'
            ? sendOfferCounterAcceptedNotification(offer.seller_id, details)
            : sendOfferAcceptedNotification(offer.buyer_id, details)
        ).catch((e) => console.error('[Offers/Accept] notify (non-fatal):', e)),
    );

    return NextResponse.json({ id: offer.id, status: 'accepted', amount: offer.amount, listing_id: offer.listing_id });
}
