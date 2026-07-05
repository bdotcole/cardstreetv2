import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapSealedRowToProduct, SealedProductRow } from '@/lib/sealedProduct';

// Sealed products (booster boxes, ETBs, packs, ...) for the catalog browse.
//   GET /api/sealed?game=pokemon&setId=sv3            -> a set's sealed products
//   GET /api/sealed?game=pokemon&q=charizard          -> search by name within a game
//   GET /api/sealed?game=all                          -> game-wide list (desktop browse)
// Prices are stored in USD; returned in THB (base) so the client multiplies by the
// display exchangeRate exactly like card.marketPrice. Row -> product mapping lives
// in lib/sealedProduct.ts, shared with the desktop card page's SSR fallback.

export const runtime = 'nodejs';

const defaultCacheControl = 'public, s-maxage=300, stale-while-revalidate=3600';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const game = searchParams.get('game') || 'pokemon';
        const setId = searchParams.get('setId');
        const language = searchParams.get('language');
        const q = (searchParams.get('q') || '').trim();

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // setsOnly=1 -> the distinct set_ids that have at least one sealed product,
        // so the catalog's sealed mode can hide sets that would render empty.
        // Keyset-paginated on set_id: PostgREST caps responses at 1000 rows and
        // has no DISTINCT, but rows arrive sorted so dedupe is a last-value check.
        if (searchParams.get('setsOnly') === '1') {
            const setIds: string[] = [];
            let cursor: string | null = null;
            for (let page = 0; page < 20; page++) {
                let idQuery = supabase
                    .from('sealed_products')
                    .select('set_id')
                    .not('set_id', 'is', null)
                    .order('set_id')
                    .limit(1000);
                if (game && game !== 'all') idQuery = idQuery.eq('game', game);
                if (language) idQuery = idQuery.eq('language', language === 'jp' ? 'jp' : language);
                if (cursor) idQuery = idQuery.gt('set_id', cursor);
                const { data, error } = await idQuery;
                if (error) {
                    console.error('[Sealed] setsOnly Supabase error:', error);
                    return NextResponse.json({ setIds: [] }, { status: 500 });
                }
                for (const row of data || []) {
                    if (setIds[setIds.length - 1] !== row.set_id) setIds.push(row.set_id);
                }
                if (!data || data.length < 1000) break;
                cursor = data[data.length - 1].set_id;
            }
            return new NextResponse(JSON.stringify({ setIds }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': defaultCacheControl },
            });
        }

        let query = supabase
            .from('sealed_products')
            .select('id, game, language, set_id, name, product_type, image_url, pricecharting_id, loose_price, cib_price, new_price, currency, last_updated');

        // game='all' (or absent) = no game filter, used by the desktop browse.
        if (game && game !== 'all') query = query.eq('game', game);
        // 'jp' (UI) maps to 'jp' stored for Japanese sealed.
        if (language) query = query.eq('language', language === 'jp' ? 'jp' : language);

        if (q.length > 1) {
            query = query.ilike('name', `%${q}%`);
        } else if (setId) {
            query = query.eq('set_id', setId);
        }
        // No set + no search => return all (game-filtered), for a game-wide browse.

        const { data, error } = await query
            .order('new_price', { ascending: false, nullsFirst: false })
            .limit(200);

        if (error) {
            console.error('[Sealed] Supabase error:', error);
            return NextResponse.json({ products: [] }, { status: 500 });
        }

        // set_id is intentionally not a FK (see the sealed_products migration), so
        // PostgREST can't embed the set — resolve display names with a second query.
        const setIds = [...new Set((data || []).map((p) => p.set_id).filter(Boolean))] as string[];
        const setNames = new Map<string, string>();
        if (setIds.length > 0) {
            const { data: sets } = await supabase.from('pokemon_sets').select('id, name').in('id', setIds);
            for (const s of sets || []) setNames.set(s.id, s.name);
        }

        const products = (data || []).map((p) =>
            mapSealedRowToProduct(p as SealedProductRow, p.set_id ? setNames.get(p.set_id) : null)
        );

        return new NextResponse(JSON.stringify({ products }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': defaultCacheControl },
        });
    } catch (error) {
        console.error('[Sealed] Failed:', error);
        return NextResponse.json({ products: [] }, { status: 500 });
    }
}
