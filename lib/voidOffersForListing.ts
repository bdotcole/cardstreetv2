import { createAdminClient } from '@/lib/supabase/admin';
import { sendOfferExpiredNotification } from '@/lib/courier';

/**
 * Void every still-open offer on a sold listing, except the one that won
 * (paidOfferId), and notify each offeror.
 *
 * Called from the authoritative post-payment point
 * (lib/fulfillOrder.ts:fulfillOrdersByTransferGroup) so there are zero false
 * voids: fulfillment only runs after payment is confirmed. Each void is a CAS
 * on `status IN ('pending','accepted')`, so a re-run (fulfillment is idempotent)
 * is a no-op.
 *
 * Flag-gated: while NEXT_PUBLIC_ENABLE_OFFERS !== '1' this early-returns, so the
 * fulfillment hook is inert even though the code is deployed. Never throws — the
 * caller wraps it, and a notification hiccup must never fail fulfillment.
 */
export async function voidOffersForSoldListing(
    listingId: string,
    paidOfferId?: string | null,
): Promise<void> {
    if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') return;

    const admin = createAdminClient();
    const { data: open } = await admin
        .from('offers')
        .select('id, buyer_id, seller_id, actor_role, amount')
        .eq('listing_id', listingId)
        .in('status', ['pending', 'accepted']);

    for (const o of open || []) {
        if (paidOfferId && o.id === paidOfferId) continue;

        const { data: won } = await admin
            .from('offers')
            .update({ status: 'expired' })
            .eq('id', o.id)
            .in('status', ['pending', 'accepted'])
            .select('id');
        if (!won || won.length !== 1) continue; // lost the race; skip

        // Notify the offeror (the party left hanging).
        const offerorId = o.actor_role === 'buyer' ? o.buyer_id : o.seller_id;
        try {
            await sendOfferExpiredNotification(offerorId, {
                offerId: o.id,
                listingId,
                amount: o.amount,
            });
        } catch (e) {
            console.error('[VoidOffers] notify (non-fatal):', e);
        }
    }
}
