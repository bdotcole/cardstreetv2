/**
 * The signed-in user's Watching list. GET → { available, items }.
 *
 * The watch rows are read as the user (RLS: own rows only). The listings
 * behind them are read with the service role on purpose: the listings SELECT
 * policy hides sold and cancelled rows from everyone but the seller, and a
 * watched card that has since sold must still show on the list, as sold,
 * rather than vanish. Nothing here reads another user's watches.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { attachSellers } from '@/lib/publicProfiles';
import { attachWatchCounts } from '@/lib/listingWatches';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import type { MarketplaceListing } from '@/services/marketplaceService';

export const dynamic = 'force-dynamic';

const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']);
// Nobody scrolls further than this on a phone; the newest watches come first.
const MAX_ROWS = 300;

export async function GET() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    type WatchRow = { listing_id: string; price_at_watch?: number | string | null; created_at: string };
    const readWatches = (columns: string) => supabase
        .from('listing_watches')
        .select(columns)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);
    let { data: watches, error } = await readWatches('listing_id, price_at_watch, created_at');
    // 42703: the table exists without price_at_watch (the first cut of the
    // migration ran in production without it); the list still works, just
    // without the "was" price.
    if (error?.code === '42703') {
        ({ data: watches, error } = await readWatches('listing_id, created_at'));
    }
    if (error) {
        if (MISSING_SCHEMA_CODES.has(error.code ?? '')) {
            return NextResponse.json({ available: false, items: [] });
        }
        console.error('[ListingWatch] list read failed:', error);
        return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
    }

    const rows = ((watches ?? []) as unknown) as WatchRow[];
    if (rows.length === 0) {
        return NextResponse.json({ available: true, items: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const admin = createAdminClient();
    const { data: listings, error: listingErr } = await admin
        .from('listings')
        .select('id, seller_id, card_id, card_data, price, condition, is_graded, grading_company, grade, image_front_url, image_back_url, accepts_offers, status, created_at, updated_at')
        .in('id', rows.map((r) => r.listing_id));
    if (listingErr) {
        console.error('[ListingWatch] listings read failed:', listingErr);
        return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
    }

    const normalized = ((listings ?? []) as unknown as MarketplaceListing[]).map((l) => ({
        ...l,
        card_data: normalizeCard(l.card_data, l.card_id),
    }));
    await Promise.all([attachSellers(admin, normalized), attachWatchCounts(admin, normalized)]);
    const byId = new Map(normalized.map((l) => [l.id, l]));

    const items = rows
        .map((w) => {
            const listing = byId.get(w.listing_id);
            // A listing whose seller is gone cannot be opened; a missing row
            // was deleted outright. Neither is something to draw.
            if (!listing || !listing.seller) return null;
            return {
                ...listing,
                watched_at: w.created_at,
                price_at_watch: w.price_at_watch === null || w.price_at_watch === undefined ? null : Number(w.price_at_watch),
            };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

    return NextResponse.json({ available: true, items }, { headers: { 'Cache-Control': 'no-store' } });
}
