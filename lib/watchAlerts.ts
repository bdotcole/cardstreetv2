import { createAdminClient } from '@/lib/supabase/admin';
import { sendWatchPriceDropAlert, sendWatchSoldAlert } from '@/lib/courier';

/**
 * Alerts for people watching a listing (20261015_listing_watches.sql,
 * 20261015b_listing_price_drops.sql). Server-only: service role + Courier.
 *
 *   - Price drop: the trigger queues a listing_price_drops row whenever a
 *     watched active listing's price goes down. notifyWatchersOfPriceDrops
 *     drains the queue — pinged by the price editors through
 *     /api/alerts/listing-price-drop, and it always sweeps every pending row,
 *     so one missed ping is caught by the next.
 *   - Sold: lib/fulfillOrder.ts calls notifyWatchersOfSale with the listings
 *     it just stamped sold_at on, which is the one moment a sale is real and
 *     happens once per listing.
 *
 * Both honour user_settings.notify_price_drops, the "Price drop alerts"
 * toggle in Settings, which had nothing behind it until now. A send failure
 * never affects the price change or the order; everything is best-effort.
 */

// Pending rows older than this are stale news, not an alert.
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A seller walking a price down in steps gets one alert per listing per
// window; later steps wait in the queue and go out with the current price.
const PER_LISTING_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// A chase card with many watchers must not turn one price edit into an
// unbounded Courier bill; first-come by watch order.
const MAX_ALERTS_PER_LISTING = 100;
const SWEEP_LIMIT = 200;

type Admin = ReturnType<typeof createAdminClient>;

interface ListingRow {
    id: string;
    card_id: string;
    card_data: Record<string, unknown> | null;
    price: number | string;
    status: string;
    seller_id: string;
}

function cardName(listing: ListingRow): string {
    const name = listing.card_data?.name;
    return typeof name === 'string' && name.trim() ? name : 'A card you are watching';
}

/** Watchers of one listing who have not switched price-drop alerts off. */
async function alertableWatchers(admin: Admin, listingId: string, exclude: string[]): Promise<string[]> {
    const { data: rows, error } = await admin
        .from('listing_watches')
        .select('user_id')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: true })
        .limit(MAX_ALERTS_PER_LISTING + exclude.length);
    if (error || !rows?.length) return [];
    const skip = new Set(exclude);
    const ids = [...new Set((rows as { user_id: string }[]).map((r) => r.user_id))].filter((id) => !skip.has(id));
    if (ids.length === 0) return [];

    // user_settings.notify_price_drops: NULL / no row = on, like the UI default.
    const { data: settings } = await admin
        .from('user_settings')
        .select('user_id, notify_price_drops')
        .in('user_id', ids);
    const optedOut = new Set(
        ((settings ?? []) as { user_id: string; notify_price_drops: boolean | null }[])
            .filter((s) => s.notify_price_drops === false)
            .map((s) => s.user_id),
    );
    return ids.filter((id) => !optedOut.has(id)).slice(0, MAX_ALERTS_PER_LISTING);
}

export async function notifyWatchersOfPriceDrops(): Promise<{ listings: number; sent: number }> {
    const admin = createAdminClient();
    const since = new Date(Date.now() - PENDING_MAX_AGE_MS).toISOString();

    const { data: pending, error } = await admin
        .from('listing_price_drops')
        .select('id, listing_id, old_price, new_price, created_at')
        .is('notified_at', null)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(SWEEP_LIMIT);
    if (error) {
        // 42P01: the migration has not run yet — nothing to drain, not a fault.
        if (error.code !== '42P01') console.error('[WatchAlerts] pending read failed:', error.message);
        return { listings: 0, sent: 0 };
    }
    if (!pending?.length) return { listings: 0, sent: 0 };

    type Drop = { id: number; listing_id: string; old_price: number | string; new_price: number | string };
    const byListing = new Map<string, Drop[]>();
    for (const row of pending as Drop[]) {
        const list = byListing.get(row.listing_id) ?? [];
        list.push(row);
        byListing.set(row.listing_id, list);
    }

    // Listings alerted within the cooldown keep their rows pending: they go
    // out, with the then-current price, on a later sweep.
    const cooldownSince = new Date(Date.now() - PER_LISTING_COOLDOWN_MS).toISOString();
    const { data: recent } = await admin
        .from('listing_price_drops')
        .select('listing_id')
        .in('listing_id', [...byListing.keys()])
        .gte('notified_at', cooldownSince);
    const cooling = new Set(((recent ?? []) as { listing_id: string }[]).map((r) => r.listing_id));

    let listingsAlerted = 0;
    let sent = 0;
    for (const [listingId, drops] of byListing) {
        if (cooling.has(listingId)) continue;

        // Claim before sending: a concurrent sweep that loses the CAS sees
        // zero rows back and leaves this listing alone.
        const { data: claimed } = await admin
            .from('listing_price_drops')
            .update({ notified_at: new Date().toISOString() })
            .in('id', drops.map((d) => d.id))
            .is('notified_at', null)
            .select('id');
        if (!claimed?.length) continue;

        const { data: listing } = await admin
            .from('listings')
            .select('id, card_id, card_data, price, status, seller_id')
            .eq('id', listingId)
            .maybeSingle<ListingRow>();
        // Gone, or back up to (or above) where it started: no news to send.
        const oldPrice = Math.max(...drops.map((d) => Number(d.old_price) || 0));
        if (!listing || listing.status !== 'active' || !(Number(listing.price) < oldPrice)) continue;

        const targets = await alertableWatchers(admin, listingId, [listing.seller_id]);
        if (targets.length === 0) continue;

        const payload = {
            listingId: listing.id,
            cardId: listing.card_id,
            cardName: cardName(listing),
            oldPrice,
            newPrice: Number(listing.price),
        };
        const results = await Promise.allSettled(targets.map((userId) => sendWatchPriceDropAlert(userId, payload)));
        const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
        sent += ok;
        if (ok > 0) listingsAlerted++;
        console.log(`[WatchAlerts] price drop on ${listing.id} (${payload.cardName}) ${oldPrice} -> ${payload.newPrice}: alerted ${ok}/${targets.length} watchers`);
    }

    return { listings: listingsAlerted, sent };
}

/**
 * Tell the watchers of each listing that it has sold. The buyer is left out
 * (they know), and so is the seller. Called once per listing by fulfilment
 * with the ids it stamped sold_at on this call, so a retried webhook cannot
 * re-send.
 */
export async function notifyWatchersOfSale(listingIds: string[], buyerId: string | null): Promise<{ sent: number }> {
    if (listingIds.length === 0) return { sent: 0 };
    const admin = createAdminClient();

    const { data: listings, error } = await admin
        .from('listings')
        .select('id, card_id, card_data, price, status, seller_id')
        .in('id', listingIds);
    if (error || !listings?.length) return { sent: 0 };

    let sent = 0;
    for (const listing of listings as ListingRow[]) {
        const targets = await alertableWatchers(admin, listing.id, [listing.seller_id, ...(buyerId ? [buyerId] : [])]);
        if (targets.length === 0) continue;
        const payload = { listingId: listing.id, cardId: listing.card_id, cardName: cardName(listing), price: Number(listing.price) };
        const results = await Promise.allSettled(targets.map((userId) => sendWatchSoldAlert(userId, payload)));
        const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
        sent += ok;
        console.log(`[WatchAlerts] ${listing.id} (${payload.cardName}) sold: told ${ok}/${targets.length} watchers`);
    }
    return { sent };
}
