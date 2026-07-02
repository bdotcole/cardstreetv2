import { createAdminClient } from '@/lib/supabase/admin';
import { isPremium } from '@/lib/entitlements';
import { sendWishlistListingAlert } from '@/lib/courier';

/**
 * Wishlist listing alerts (CardStreet Pro perk).
 *
 * When a listing goes active, tell every Pro user who has that card on their
 * wishlist. Server-only (service role + Courier) -- reached from the two
 * listing-creation paths:
 *   - app/api/listings/route.ts POST        (fires post-response via after())
 *   - /api/alerts/listing-created           (pinged by the client-side
 *     services/marketplaceService.createListing insert)
 *
 * A send failure must never affect the listing itself; everything here is
 * best-effort and errors only log.
 */

// A hot card (e.g. a chase card many users wishlist) must not turn one listing
// into an unbounded Courier bill; first-come by wishlist row order.
const MAX_ALERTS_PER_LISTING = 25;
// One alert per user+card per window, so relists/multiple copies don't spam.
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function notifyWishlistersOfListing(listingId: string): Promise<{ sent: number }> {
  const admin = createAdminClient();

  const { data: listing, error: listingErr } = await admin
    .from('listings')
    .select('id, card_id, card_data, price, condition, seller_id, status')
    .eq('id', listingId)
    .single();
  if (listingErr || !listing || listing.status !== 'active') return { sent: 0 };

  const { data: wishRows, error: wishErr } = await admin
    .from('wishlists')
    .select('user_id')
    .eq('card_id', listing.card_id)
    .neq('user_id', listing.seller_id)
    .order('added_at', { ascending: true })
    .limit(500);
  if (wishErr || !wishRows?.length) return { sent: 0 };

  const userIds = [...new Set(wishRows.map((r: any) => r.user_id as string))];

  // Pro-only perk: same entitlement rule as lib/premiumAuth getEntitlement
  // (active subscription OR admin role).
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, role, premium_until')
    .in('id', userIds);
  const proIds = (profiles || [])
    .filter((p: any) => p.role === 'admin' || isPremium(p.premium_until))
    .map((p: any) => p.id as string);
  if (proIds.length === 0) return { sent: 0 };

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from('wishlist_alert_log')
    .select('user_id')
    .eq('card_id', listing.card_id)
    .in('user_id', proIds)
    .gte('sent_at', since);
  const alreadyAlerted = new Set((recent || []).map((r: any) => r.user_id as string));

  const targets = proIds.filter((id) => !alreadyAlerted.has(id)).slice(0, MAX_ALERTS_PER_LISTING);
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
    `[WishlistAlerts] listing ${listingId} (${payload.cardName}): alerted ${sentTo.length}/${proIds.length} Pro wishlisters` +
    (alreadyAlerted.size ? ` (${alreadyAlerted.size} deduped)` : ''),
  );
  return { sent: sentTo.length };
}
