/**
 * The signed-in user's own follow lists, for Profile's Following / Followers
 * panels. GET ?kind=following|followers → { available, users }.
 *
 * Own lists only: RLS on seller_follows lets each side read the rows that
 * involve them, and there is deliberately no way to list a third party's
 * followers. Names and avatars come from the public_profiles view; the
 * listing count tells a buyer which followed shops have stock right now.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchPublicSellers } from '@/lib/publicProfiles';

export const dynamic = 'force-dynamic';

const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01']);

// A follow list beyond this is not a list anyone scrolls on a phone; the
// count on the profile header stays exact either way.
const MAX_ROWS = 500;
const MAX_COUNTED_SHOPS = 60;

export async function GET(request: NextRequest) {
    const kind = request.nextUrl.searchParams.get('kind');
    if (kind !== 'following' && kind !== 'followers') {
        return NextResponse.json({ error: 'kind must be following or followers' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mine = kind === 'following' ? 'follower_id' : 'seller_id';
    const other = kind === 'following' ? 'seller_id' : 'follower_id';
    const { data: rows, error } = await supabase
        .from('seller_follows')
        .select('follower_id, seller_id, created_at')
        .eq(mine, user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);

    if (error) {
        if (MISSING_SCHEMA_CODES.has(error.code ?? '')) {
            return NextResponse.json({ available: false, users: [] });
        }
        console.error('[Follows] list failed:', error);
        return NextResponse.json({ error: 'Failed to load follows' }, { status: 500 });
    }

    const follows = (rows ?? []) as { follower_id: string; seller_id: string; created_at: string }[];
    const ids = follows.map((r) => r[other]);
    const profiles = await fetchPublicSellers(supabase, ids);

    // Active stock per followed shop. Followers are mostly buyers, so the
    // count is only worth a query on the Following side. One head count per
    // shop rather than one row fetch for all of them: PostgREST caps a
    // response at 1000 rows, so a single big shop would starve the others'
    // counts. Capped at the most recent follows; the rest show no count.
    const listingCounts = new Map<string, number>();
    if (kind === 'following' && ids.length > 0) {
        await Promise.all(ids.slice(0, MAX_COUNTED_SHOPS).map(async (id) => {
            const { count } = await supabase
                .from('listings')
                .select('id', { count: 'exact', head: true })
                .eq('seller_id', id)
                .eq('status', 'active');
            listingCounts.set(id, count ?? 0);
        }));
    }

    const users = follows
        .map((r) => {
            const id = r[other];
            const p = profiles.get(id);
            // A deleted account cascades its rows away; a missing view row is
            // a profile we cannot show, so leave it out rather than draw a blank.
            if (!p) return null;
            return {
                id,
                username: p.username ?? null,
                display_name: p.display_name ?? null,
                avatar_url: p.avatar_url ?? null,
                listing_count: listingCounts.get(id) ?? null,
                followed_at: r.created_at,
            };
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);

    return NextResponse.json({ available: true, users }, { headers: { 'Cache-Control': 'no-store' } });
}
