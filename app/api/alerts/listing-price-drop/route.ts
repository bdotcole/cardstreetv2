import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { notifyWatchersOfPriceDrops } from '@/lib/watchAlerts';

// Price-drop alert sweep for watched listings. The price editors
// (services/marketplaceService updateListingPrice / updateListingPriceForCard,
// plain UPDATEs from the browser) ping this fire-and-forget after a save; the
// trigger in 20261015b_listing_price_drops.sql has already queued the drop.
// The sweep drains EVERY pending row, not just the caller's, so it is
// harmless to call often and a missed ping is caught by the next one.
//
// Signed-in callers only, to keep a public URL from driving Courier sends;
// which user calls it makes no difference to what goes out.

export async function POST() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // After the response: the seller's price save must never wait on Courier.
    after(() =>
        notifyWatchersOfPriceDrops().catch((e) =>
            console.error('[WatchAlerts] price-drop sweep failed:', e),
        ),
    );
    return NextResponse.json({ queued: true });
}
