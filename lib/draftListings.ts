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

export async function publishDraftListings(
    admin: SupabaseClient,
    sellerIds: string[],
    logPrefix: string,
): Promise<number> {
    if (sellerIds.length === 0) return 0;

    const { data, error } = await admin
        .from('listings')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .in('seller_id', sellerIds)
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
