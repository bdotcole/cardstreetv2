/**
 * How many people want a card — the demand signal sellers never had.
 *
 * The marketplace's measured problem is demand, and the one demand signal the
 * app already collects (297 wishlist rows) was visible to nobody but the person
 * who wrote it. A seller looking at their vault had no way to know that three
 * people were waiting for a card sitting in it, and the "most wanted" list
 * below is the closest thing to a shopping list this platform can hand a
 * seller.
 *
 * Service-role because these are aggregates over other users' private wishlist
 * rows. ONLY counts leave this route — never a user id, never a display name.
 * A count of 1 is still published: with a total of 297 rows across 289 cards,
 * suppressing singletons would suppress essentially the whole signal, and a
 * bare number identifies nobody.
 *
 * GET ?cardIds=a,b,c   -> { counts: { <cardId>: n } }
 * GET ?mode=most_wanted -> { items: [{ cardId, wishlisters, card }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ids per request. Generous enough for a full vault page, bounded enough that
 *  the .in() filter cannot blow the PostgREST URL length. */
const MAX_IDS = 200;
const MOST_WANTED_LIMIT = 20;
const PAGE = 1000;

/**
 * Cached at the edge for a minute. Wishlist counts move slowly and this is
 * rendered on every vault page and card detail; a per-render round trip to
 * Postgres for a number that changes a few times a day is waste.
 */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const admin = createAdminClient();

    try {
        if (searchParams.get('mode') === 'most_wanted') {
            // Every wishlist row, paged: .limit() alone silently caps at 1000,
            // and a partial read here would quietly under-report demand.
            const counts = new Map<string, number>();
            const sample = new Map<string, Record<string, unknown>>();
            for (let from = 0; ; from += PAGE) {
                const { data, error } = await admin
                    .from('wishlists')
                    .select('card_id, card_data')
                    .order('card_id', { ascending: true })
                    .range(from, from + PAGE - 1);
                if (error) throw error;
                for (const row of data ?? []) {
                    const id = row.card_id as string;
                    counts.set(id, (counts.get(id) ?? 0) + 1);
                    if (!sample.has(id) && row.card_data) {
                        sample.set(id, row.card_data as Record<string, unknown>);
                    }
                }
                if (!data || data.length < PAGE) break;
            }
            if (counts.size === 0) return NextResponse.json({ items: [] }, { headers: CACHE_HEADERS });

            // Drop anything already for sale: the point of this list is to show
            // a seller demand nobody is currently meeting. A card with a live
            // listing is answered, however many people want it.
            const ids = [...counts.keys()];
            const listed = new Set<string>();
            const CHUNK = 200;
            for (let i = 0; i < ids.length; i += CHUNK) {
                const { data } = await admin
                    .from('listings')
                    .select('card_id')
                    .eq('status', 'active')
                    .in('card_id', ids.slice(i, i + CHUNK));
                for (const l of data ?? []) listed.add(l.card_id as string);
            }

            const items = ids
                .filter((id) => !listed.has(id))
                .map((id) => ({
                    cardId: id,
                    wishlisters: counts.get(id) ?? 0,
                    card: sample.get(id) ?? null,
                }))
                .sort((a, b) => b.wishlisters - a.wishlisters)
                .slice(0, MOST_WANTED_LIMIT);

            return NextResponse.json({ items }, { headers: CACHE_HEADERS });
        }

        const raw = (searchParams.get('cardIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (raw.length === 0) return NextResponse.json({ counts: {} }, { headers: CACHE_HEADERS });
        const ids = [...new Set(raw)].slice(0, MAX_IDS);

        const { data, error } = await admin
            .from('wishlists')
            .select('card_id')
            .in('card_id', ids);
        if (error) throw error;

        const counts: Record<string, number> = {};
        for (const row of data ?? []) {
            const id = row.card_id as string;
            counts[id] = (counts[id] ?? 0) + 1;
        }
        return NextResponse.json({ counts }, { headers: CACHE_HEADERS });
    } catch (err) {
        console.error('[WishlistDemand] error:', err);
        // Fail soft: a demand badge is decoration, and an error here must not
        // take out the vault page that renders it.
        return NextResponse.json({ counts: {}, items: [] }, { status: 200 });
    }
}
