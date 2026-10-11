import { createAdminClient } from '@/lib/supabase/admin';
import { sendWishlistListingAlert } from '@/lib/courier';

/**
 * Wishlist listing alerts.
 *
 * When a listing goes active, tell every user who has that card on their
 * wishlist. Server-only (service role + Courier) -- reached from the two
 * listing-creation paths:
 *   - app/api/listings/route.ts POST        (fires post-response via after())
 *   - /api/alerts/listing-created           (pinged by the client-side
 *     services/marketplaceService.createListing insert)
 *
 * Alerts only go out for listings whose seller can actually be paid; the ones
 * skipped for that reason are replayed by notifyWishlistersOfSellerActivation.
 *
 * A send failure must never affect the listing itself; everything here is
 * best-effort and errors only log.
 */

// A hot card (e.g. a chase card many users wishlist) must not turn one listing
// into an unbounded Courier bill; first-come by wishlist row order.
const MAX_ALERTS_PER_LISTING = 25;
// One alert per user+card per window, so relists/multiple copies don't spam.
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Bounds for the activation replay below.
const ACTIVATION_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVATION_REPLAY_LISTINGS = 20;

export async function notifyWishlistersOfListing(listingId: string): Promise<{ sent: number }> {
  const admin = createAdminClient();

  const { data: listing, error: listingErr } = await admin
    .from('listings')
    .select('id, card_id, card_data, price, condition, seller_id, status')
    .eq('id', listingId)
    .single();
  if (listingErr || !listing || listing.status !== 'active') return { sent: 0 };

  // Active is not the same as buyable. A seller may list once they finish
  // Stripe's KYC form (stripe_details_submitted — see lib/profileValidation.ts),
  // but both checkout routes require stripe_charges_enabled, so between those
  // two states the listing is live and every purchase attempt is rejected.
  // Alerting then points a Pro user at a card they cannot buy. The alert is
  // deferred rather than dropped: notifyWishlistersOfSellerActivation replays
  // it when charges are switched on.
  const { data: seller } = await admin
    .from('profiles')
    .select('stripe_charges_enabled')
    .eq('id', listing.seller_id)
    .single();
  if (seller?.stripe_charges_enabled !== true) {
    console.log(
      `[WishlistAlerts] listing ${listingId}: deferred, seller not yet chargeable`,
    );
    return { sent: 0 };
  }

  const { data: wishRows, error: wishErr } = await admin
    .from('wishlists')
    .select('user_id')
    .eq('card_id', listing.card_id)
    .neq('user_id', listing.seller_id)
    .order('added_at', { ascending: true })
    .limit(500);
  if (wishErr || !wishRows?.length) return { sent: 0 };

  // Every wishlister, not just Pro ones. This was gated on the same
  // entitlement rule as lib/premiumAuth getEntitlement until 2026-09-05; see
  // lib/entitlements.ts FEATURE_TIERS.wishlist_alerts for why it was opened up.
  // The alert is the only thing that turns a wishlist into a return visit, and
  // gating it meant the wishlists of ~1,070 free accounts were inert.
  const targetIds = [...new Set(wishRows.map((r: any) => r.user_id as string))];
  if (targetIds.length === 0) return { sent: 0 };

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from('wishlist_alert_log')
    .select('user_id')
    .eq('card_id', listing.card_id)
    .in('user_id', targetIds)
    .gte('sent_at', since);
  const alreadyAlerted = new Set((recent || []).map((r: any) => r.user_id as string));

  const targets = targetIds.filter((id) => !alreadyAlerted.has(id)).slice(0, MAX_ALERTS_PER_LISTING);
  if (targets.length === 0) return { sent: 0 };

  const cardData = (listing.card_data || {}) as Record<string, any>;
  const payload = {
    listingId: listing.id as string,
    cardId: listing.card_id as string,
    cardName: (cardData.name as string) || 'A card on your wishlist',
    price: Number(listing.price),
    condition: (listing.condition as string) || '',
  };

  const results = await Promise.allSettled(
    targets.map((userId) => sendWishlistListingAlert(userId, payload)),
  );
  const sentTo = targets.filter(
    (_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<boolean>).value,
  );

  if (sentTo.length > 0) {
    const { error: logErr } = await admin.from('wishlist_alert_log').insert(
      sentTo.map((user_id) => ({
        user_id,
        card_id: listing.card_id,
        listing_id: listing.id,
      })),
    );
    if (logErr) console.error('[WishlistAlerts] failed to log sends:', logErr.message);
  }

  console.log(
    `[WishlistAlerts] listing ${listingId} (${payload.cardName}): alerted ${sentTo.length}/${targetIds.length} wishlisters` +
    (alreadyAlerted.size ? ` (${alreadyAlerted.size} deduped)` : ''),
  );
  return { sent: sentTo.length };
}

/**
 * Replay the alerts notifyWishlistersOfListing skipped while a seller was not
 * yet chargeable, so a deferred alert is never silently lost.
 *
 * Fires from the account.updated webhook on the charges_enabled false -> true
 * EDGE only. Stripe emits account.updated for many unrelated reasons (payouts,
 * balance changes, requirement refreshes), and replaying on every one would
 * re-alert the same listings once a day forever — the dedupe above is keyed on
 * user+card with a 24h window, so it would not hold the line.
 *
 * Bounded by age and count: a seller who activates with a large back catalogue
 * must not fan out an unbounded Courier bill.
 */
export async function notifyWishlistersOfSellerActivation(
  sellerIds: string[],
  logPrefix = '[WishlistAlerts]',
): Promise<{ replayed: number }> {
  if (sellerIds.length === 0) return { replayed: 0 };
  const admin = createAdminClient();

  const since = new Date(Date.now() - ACTIVATION_REPLAY_WINDOW_MS).toISOString();
  const { data: listings, error } = await admin
    .from('listings')
    .select('id')
    .in('seller_id', sellerIds)
    .eq('status', 'active')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ACTIVATION_REPLAY_LISTINGS);
  if (error) {
    console.error(`${logPrefix} activation replay query failed:`, error.message);
    return { replayed: 0 };
  }
  if (!listings?.length) return { replayed: 0 };

  let replayed = 0;
  for (const row of listings) {
    const id = row.id as string;
    try {
      const { sent } = await notifyWishlistersOfListing(id);
      if (sent > 0) replayed++;
    } catch (e) {
      console.error(`${logPrefix} activation replay failed for listing ${id}:`, e);
    }
  }

  console.log(
    `${logPrefix} activation replay: alerted ${replayed}/${listings.length} listing(s) ` +
    `across ${sellerIds.length} seller(s)`,
  );
  return { replayed };
}
