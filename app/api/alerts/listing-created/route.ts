import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { notifyWishlistersOfListing } from '@/lib/wishlistAlerts';
import { submitCardIdsToIndexNow } from '@/lib/indexNow';

// Wishlist-alert fan-out trigger for the CLIENT-SIDE listing path
// (services/marketplaceService.createListing inserts straight from the
// browser, so no server code runs at insert time). The client pings this
// fire-and-forget after a successful insert. The API listing path
// (app/api/listings POST) fans out directly via after() instead.

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const listingId = typeof body?.listingId === 'string' ? body.listingId : null;
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 });

  // Only the listing's own seller may trigger its fan-out, and the 24h dedupe
  // log in notifyWishlistersOfListing makes repeat calls harmless.
  const { data: listing } = await supabase
    .from('listings')
    .select('id, seller_id, card_id')
    .eq('id', listingId)
    .single();
  if (!listing || listing.seller_id !== user.id) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  // Best-effort recrawl hint for the card page this listing appears on.
  void submitCardIdsToIndexNow([listing.card_id]);

  const result = await notifyWishlistersOfListing(listingId);
  return NextResponse.json(result);
}
