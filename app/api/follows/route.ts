/**
 * Follow a shop (20261014_seller_follows.sql).
 *
 *   GET    ?user_id=<id>        → { available, followers, following, isFollowing }
 *   POST   { seller_id }         → { isFollowing: true, followers }
 *   DELETE ?seller_id=<id>       → { isFollowing: false, followers }
 *
 * Writes go through the cookie client, so the table's RLS (follower_id =
 * auth.uid()) is what stops anyone following on someone else's behalf; there
 * is no follower id in the body to spoof. Counts come from follow_counts(),
 * which returns totals only, so a shop's follower count is public while the
 * list of who follows it is not.
 *
 * Fails soft before the migration runs: GET reports available: false (the
 * app hides the counts) and writes answer 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST/Postgres codes for "the migration has not run yet".
const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01']);
function isMissingSchema(error: { code?: string } | null | undefined): boolean {
    return !!error?.code && MISSING_SCHEMA_CODES.has(error.code);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function readCounts(supabase: Supabase, userId: string) {
    const { data, error } = await supabase.rpc('follow_counts', { p_user_id: userId });
    if (error) return { error };
    const counts = (data ?? {}) as { followers?: number; following?: number };
    return { followers: Number(counts.followers) || 0, following: Number(counts.following) || 0 };
}

export async function GET(request: NextRequest) {
    const userId = request.nextUrl.searchParams.get('user_id') || '';
    if (!UUID_RE.test(userId)) {
        return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const counts = await readCounts(supabase, userId);
    if ('error' in counts) {
        if (isMissingSchema(counts.error)) {
            return NextResponse.json({ available: false, followers: 0, following: 0, isFollowing: false });
        }
        console.error('[Follows] follow_counts failed:', counts.error);
        return NextResponse.json({ error: 'Failed to load follows' }, { status: 500 });
    }

    let isFollowing = false;
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.id !== userId) {
        const { data } = await supabase
            .from('seller_follows')
            .select('seller_id')
            .eq('follower_id', user.id)
            .eq('seller_id', userId)
            .maybeSingle();
        isFollowing = !!data;
    }

    return NextResponse.json(
        { available: true, ...counts, isFollowing },
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
    const sellerId = typeof body?.seller_id === 'string' ? body.seller_id : '';
    if (!UUID_RE.test(sellerId)) {
        return NextResponse.json({ error: 'seller_id is required' }, { status: 400 });
    }
    if (sellerId === user.id) {
        return NextResponse.json({ error: 'You cannot follow your own shop' }, { status: 400 });
    }

    // Cross-user read goes through the public view (the base table is own-row only).
    const { data: seller } = await supabase.from('public_profiles').select('id').eq('id', sellerId).maybeSingle();
    if (!seller) {
        return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const { error: insertErr } = await supabase
        .from('seller_follows')
        .insert({ follower_id: user.id, seller_id: sellerId });
    // 23505: already following (a double tap, or a second device) — same outcome.
    if (insertErr && insertErr.code !== '23505') {
        if (isMissingSchema(insertErr)) {
            return NextResponse.json({ error: 'Following is not available yet', code: 'NOT_AVAILABLE' }, { status: 503 });
        }
        console.error('[Follows] follow insert failed:', insertErr);
        return NextResponse.json({ error: 'Failed to follow' }, { status: 500 });
    }

    const counts = await readCounts(supabase, sellerId);
    return NextResponse.json({ isFollowing: true, followers: 'error' in counts ? null : counts.followers });
}

export async function DELETE(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sellerId = request.nextUrl.searchParams.get('seller_id') || '';
    if (!UUID_RE.test(sellerId)) {
        return NextResponse.json({ error: 'seller_id is required' }, { status: 400 });
    }

    const { error: deleteErr } = await supabase
        .from('seller_follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('seller_id', sellerId);
    if (deleteErr) {
        if (isMissingSchema(deleteErr)) {
            return NextResponse.json({ error: 'Following is not available yet', code: 'NOT_AVAILABLE' }, { status: 503 });
        }
        console.error('[Follows] unfollow failed:', deleteErr);
        return NextResponse.json({ error: 'Failed to unfollow' }, { status: 500 });
    }

    const counts = await readCounts(supabase, sellerId);
    return NextResponse.json({ isFollowing: false, followers: 'error' in counts ? null : counts.followers });
}
