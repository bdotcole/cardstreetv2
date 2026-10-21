/**
 * Draft-first listings: publish a seller's drafts once Stripe onboarding
 * completes (details_submitted). Called from BOTH places that learn about
 * completion — app/api/stripe/connect/status (?refresh=1, the return-from-
 * onboarding path) and lib/stripeWebhook (account.updated, the async
 * backstop for sellers who close the tab) — so drafts can't be stranded.
 *
 * Server-only: takes a service-role client (drafts are owner-locked by RLS).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyWishlistersOfListing } from '@/lib/wishlistAlerts';
import { submitCardIdsToIndexNow } from '@/lib/indexNow';
import { listingPhotosSatisfied } from '@/lib/listingPhotoPolicy';

// PostgREST caps a response at 1,000 rows whatever the limit asks for.
const PAGE = 1000;

export async function publishDraftListings(
    admin: SupabaseClient,
    sellerIds: string[],
    logPrefix: string,
): Promise<number> {
    if (sellerIds.length === 0) return 0;

    // Only drafts that carry the photos the policy asks of them go live
    // (lib/listingPhotoPolicy.ts). The database refuses a draft->active flip
    // without them, and one such row would fail the whole UPDATE and strand
    // every compliant draft with it. The rest stay drafts; the seller relists
    // them from the vault with photos. Drafts from the collection importer are
    // the usual case: a sheet carries list prices but never photos.
    const publishable: string[] = [];
    let held = 0;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('listings')
            .select('id, price, condition, image_front_url, image_back_url')
            .in('seller_id', sellerIds)
            .eq('status', 'draft')
            .order('id')
            .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
            if (listingPhotosSatisfied({ ...row, price: Number(row.price) })) publishable.push(row.id);
            else held++;
        }
        if ((data?.length ?? 0) < PAGE) break;
    }
    if (held > 0) {
        console.log(`${logPrefix} Held ${held} draft listing(s) that need seller photos at their price/condition`);
    }
    if (publishable.length === 0) return 0;

    const { data, error } = await admin
        .from('listings')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .in('id', publishable)
        .eq('status', 'draft')
        .select('id, card_id');

    if (error) throw error;

    const published = data ?? [];
    if (published.length > 0) {
        console.log(
            `${logPrefix} Published ${published.length} draft listing(s) across ${sellerIds.length} seller(s)`,
        );
        // Wishlist alerts fire at publish time — createListing deliberately
        // skips them for drafts so wishlisters are never pointed at an
        // unbuyable listing. Strictly fire-and-forget.
        for (const row of published) {
            void notifyWishlistersOfListing(row.id).catch(() => { /* best-effort */ });
        }
        // One batched IndexNow submission for every card page that just gained
        // a buyable listing (a seller's whole draft backlog publishes at once).
        void submitCardIdsToIndexNow(published.map((row) => row.card_id));
    }
    return published.length;
}
