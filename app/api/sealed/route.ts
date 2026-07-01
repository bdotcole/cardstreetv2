import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EXCHANGE_RATES } from '@/constants';

// Sealed products (booster boxes, ETBs, packs, ...) for the catalog browse.
//   GET /api/sealed?game=pokemon&setId=sv3            -> a set's sealed products
//   GET /api/sealed?game=pokemon&q=charizard          -> search by name within a game
//   GET /api/sealed?game=all                          -> game-wide list (desktop browse)
// Prices are stored in USD; returned in THB (base) so the client multiplies by the
// display exchangeRate exactly like card.marketPrice.

export const runtime = 'nodejs';

const defaultCacheControl = 'public, s-maxage=300, stale-while-revalidate=3600';
const USD_TO_THB = 1 / (EXCHANGE_RATES['USD'] || 0.028);

// PriceCharting rows are stored in USD and converted to the THB base; Thai retail-SRP
// rows are stored THB-native (currency='THB') and passed through unconverted.
const toThb = (val: number | null | undefined, currency: string) => {
    if (typeof val !== 'number' || val <= 0) return null;
    return currency === 'THB' ? Math.round(val) : Math.round(val * USD_TO_THB);
};

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

        const products = (data || []).map((p) => {
            const cur = p.currency || 'USD';
            const sealed = toThb(p.new_price, cur);
            const cib = toThb(p.cib_price, cur);
            const loose = toThb(p.loose_price, cur);
            return {
                id: p.id,
                name: p.name,
                productType: p.product_type,
                setId: p.set_id,
                imageUrl: p.image_url,
                // Headline = factory-sealed, falling back to CIB then loose.
                price: sealed ?? cib ?? loose,
                prices: { sealed, cib, loose },
                currency: 'THB',
                // Thai rows: JP-twin-derived estimate (pricecharting_id = the JP box)
                // or plain retail SRP (no JP twin). Everything else: PriceCharting market.
                priceType: p.language === 'th' ? (p.pricecharting_id ? 'estimate' : 'srp') : 'market',
                lastUpdated: p.last_updated,
            };
        });

        return new NextResponse(JSON.stringify({ products }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': defaultCacheControl },
        });
    } catch (error) {
        console.error('[Sealed] Failed:', error);
        return NextResponse.json({ products: [] }, { status: 500 });
    }
}
