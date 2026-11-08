import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { englishJpSetName } from '@/lib/japaneseSetNames';

// Cache configuration
const defaultCacheControl = 'public, s-maxage=3600, stale-while-revalidate=86400';

// A catalog id without its language suffix: S11a-th and S11a are one product.
const twinIdOf = (id: string): string => id.replace(/-(?:th|jp|ja|en)$/i, '');

// Which sealed product stands in for a set that has no logo: the booster pack
// is what a collector recognises a set by; the box and the rest follow.
const PRODUCT_ART_PREFERENCE = ['booster_pack', 'booster_box', 'etb', 'bundle', 'collection', 'other'];
const productArtRank = (type: string | null): number => {
    const i = PRODUCT_ART_PREFERENCE.indexOf(type || '');
    return i === -1 ? PRODUCT_ART_PREFERENCE.length : i;
};

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language') || 'en';
        const game = searchParams.get('game') || 'pokemon';
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '25');

        // Calculate pagination offsets
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        // Map app language to database language
        let dbLang = 'en';
        if (language?.includes('jp')) dbLang = 'ja';
        if (language?.includes('th')) dbLang = 'th';

        // Use service role for backend-to-backend fetch to bypass RLS latency and cache at edge
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: sets, error, count } = await supabase
            .from('pokemon_sets')
            .select('id, name, series, printed_total, total, release_date, updated_at, symbol_url, logo_url', { count: 'exact' })
            .eq('game', game)
            .eq('language', dbLang)
            .order('release_date', { ascending: false, nullsFirst: false })
            .range(from, to);

        if (error) {
            console.error('Supabase error fetching sets:', error);
            return NextResponse.json({ data: [], totalCount: 0 }, { status: 500 });
        }

        const rows = sets || [];
        const missingLogo = rows.filter((s) => !s.logo_url);

        // Thai sets reprint a Japanese product 1:1 under the same code, and the
        // older Thai rows (S5a-th .. S11a-th, SVM-th) carry no logo while the
        // JP twin does. Borrow the twin's: it is the same artwork, only the
        // wordmark's script differs, and it beats a blank tile.
        const ownIds = new Set(rows.map((s) => s.id));
        const twinIds = [...new Set(missingLogo.map((s) => twinIdOf(s.id)).filter((id) => id && !ownIds.has(id)))];
        const twinArt = new Map<string, { logo_url: string | null; symbol_url: string | null }>();
        if (twinIds.length > 0) {
            const { data: twins } = await supabase
                .from('pokemon_sets')
                .select('id, logo_url, symbol_url')
                .in('id', twinIds)
                .not('logo_url', 'is', null)
                .neq('logo_url', '');
            for (const t of twins || []) twinArt.set(t.id, t);
        }

        // Pack or box photo for every set still without a logo of its own. The
        // sealed catalog carries one for most Thai sets, and the set tiles fall
        // through to it when the logo is missing or fails to load.
        const productArt = new Map<string, { url: string; rank: number }>();
        if (missingLogo.length > 0) {
            const { data: products } = await supabase
                .from('sealed_products')
                .select('set_id, product_type, image_url')
                .in('set_id', missingLogo.map((s) => s.id))
                .not('image_url', 'is', null)
                .limit(500);
            for (const p of products || []) {
                if (!p.set_id || !p.image_url) continue;
                const rank = productArtRank(p.product_type);
                const current = productArt.get(p.set_id);
                if (!current || rank < current.rank) productArt.set(p.set_id, { url: p.image_url, rank });
            }
        }

        const fixTcgdexUrl = (url: string | null | undefined): string => {
            if (!url) return '';
            if (url.includes('tcgdex.net') && !url.match(/\.(png|jpg|jpeg|webp|svg)$/i)) {
                return `${url}.png`;
            }
            return url;
        };

        // Transform Supabase data to match API format expected by frontend
        const transformedSets = rows.map(s => {
            const twin = s.logo_url ? null : twinArt.get(twinIdOf(s.id)) ?? null;
            return {
                id: s.id,
                name: englishJpSetName(s.id, s.name),
                series: s.series || '',
                printedTotal: s.printed_total || 0,
                total: s.total || 0,
                releaseDate: s.release_date || '',
                updatedAt: s.updated_at || '',
                images: {
                    symbol: fixTcgdexUrl(s.symbol_url || twin?.symbol_url),
                    logo: fixTcgdexUrl(s.logo_url || twin?.logo_url),
                    product: productArt.get(s.id)?.url || '',
                }
            };
        });

        // Return Data with Cache-Control headers
        return new NextResponse(JSON.stringify({ data: transformedSets, totalCount: count || 0 }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': defaultCacheControl
            }
        });

    } catch (error) {
        console.error("Failed to fetch sets from API route:", error);
        return NextResponse.json({ data: [], totalCount: 0 }, { status: 500 });
    }
}
