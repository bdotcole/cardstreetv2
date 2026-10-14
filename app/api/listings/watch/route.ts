/**
 * Watch a listing (20261015_listing_watches.sql).
 *
 *   GET                          → { available, listingIds }   the caller's own watchlist
 *   POST   { listing_id }        → { isWatching: true, watchers }
 *   DELETE ?listing_id=<id>      → { isWatching: false, watchers }
 *
 * Writes go through the cookie client, so the table's RLS (user_id =
 * auth.uid()) is what stops anyone watching on someone else's behalf; there
 * is no user id in the body to spoof. Counts come from listing_watch_counts(),
 * which returns totals only, so a listing's watcher count is public while the
 * list of who watches it is not.
 *
 * Fails soft before the migration runs: GET reports available: false and
 * writes answer 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchWatchCounts } from '@/lib/listingWatches';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST/Postgres codes for "the migration has not run yet".
const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01']);
function isMissingSchema(error: { code?: string } | null | undefined): boolean {
    return !!error?.code && MISSING_SCHEMA_CODES.has(error.code);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function watchersOf(supabase: Supabase, listingId: string): Promise<number> {
    const counts = await fetchWatchCounts(supabase, [listingId]);
    return counts.get(listingId) ?? 0;
}

export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ available: true, listingIds: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const { data, error } = await supabase
        .from('listing_watches')
        .select('listing_id')
        .eq('user_id', user.id);
    if (error) {
        if (isMissingSchema(error)) {
            return NextResponse.json({ available: false, listingIds: [] });
        }
        console.error('[ListingWatch] watchlist read failed:', error);
        return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
    }

    return NextResponse.json(
        { available: true, listingIds: (data ?? []).map((r) => r.listing_id) },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const listingId = typeof body?.listing_id === 'string' ? body.listing_id : '';
    if (!UUID_RE.test(listingId)) {
        return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
    }

    // Active listings are readable by everyone, so a miss here is a listing
    // that is gone (or was never visible to this caller).
    const { data: listing } = await supabase
        .from('listings')
        .select('id, seller_id, price')
        .eq('id', listingId)
        .maybeSingle();
    if (!listing) {
        return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    if (listing.seller_id === user.id) {
        return NextResponse.json({ error: 'You cannot watch your own listing', code: 'OWN_LISTING' }, { status: 400 });
    }

    // The price at watch time lets the Watching list show how far a card has
    // come down since.
    const { error: insertErr } = await supabase
        .from('listing_watches')
        .insert({ user_id: user.id, listing_id: listingId, price_at_watch: Number(listing.price) || null });
    // 23505: already watching (a double tap, or a second device) — same outcome.
    if (insertErr && insertErr.code !== '23505') {
        if (isMissingSchema(insertErr)) {
            return NextResponse.json({ error: 'Watching is not available yet', code: 'NOT_AVAILABLE' }, { status: 503 });
        }
        console.error('[ListingWatch] watch insert failed:', insertErr);
        return NextResponse.json({ error: 'Failed to watch' }, { status: 500 });
    }

    return NextResponse.json({ isWatching: true, watchers: await watchersOf(supabase, listingId) });
}

export async function DELETE(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const listingId = request.nextUrl.searchParams.get('listing_id') || '';
    if (!UUID_RE.test(listingId)) {
        return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
    }

    const { error: deleteErr } = await supabase
        .from('listing_watches')
        .delete()
        .eq('user_id', user.id)
        .eq('listing_id', listingId);
    if (deleteErr) {
        if (isMissingSchema(deleteErr)) {
            return NextResponse.json({ error: 'Watching is not available yet', code: 'NOT_AVAILABLE' }, { status: 503 });
        }
        console.error('[ListingWatch] unwatch failed:', deleteErr);
        return NextResponse.json({ error: 'Failed to unwatch' }, { status: 500 });
    }

    return NextResponse.json({ isWatching: false, watchers: await watchersOf(supabase, listingId) });
}
