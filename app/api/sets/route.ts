import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Cache configuration
const defaultCacheControl = 'public, s-maxage=3600, stale-while-revalidate=86400';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language') || 'en';
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
            .eq('language', dbLang)
            .order('release_date', { ascending: false, nullsFirst: false })
            .range(from, to);

        if (error) {
            console.error('Supabase error fetching sets:', error);
            return NextResponse.json({ data: [], totalCount: 0 }, { status: 500 });
        }

        // Transform Supabase data to match API format expected by frontend
        const transformedSets = (sets || []).map(s => {
            const fixTcgdexUrl = (url: string | null): string => {
                if (!url) return '';
                if (url.includes('tcgdex.net') && !url.match(/\.(png|jpg|jpeg|webp|svg)$/i)) {
                    return `${url}.png`;
                }
                return url;
            };


            return {
                id: s.id,
                name: s.name,
                series: s.series || '',
                printedTotal: s.printed_total || 0,
                total: s.total || 0,
                releaseDate: s.release_date || '',
                updatedAt: s.updated_at || '',
                images: {
                    symbol: fixTcgdexUrl(s.symbol_url),
                    logo: fixTcgdexUrl(s.logo_url)
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
