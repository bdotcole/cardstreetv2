
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// 24 Hour Cache for Sets (they rarely change)
export const revalidate = 86400;

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const orderBy = searchParams.get('orderBy') || '-releaseDate';
    const language = searchParams.get('language') || 'en';

    try {
        const supabase = await createClient();

        // Map languages
        let dbLang = 'en';
        if (language.toLowerCase().includes('jp') || language.toLowerCase() === 'ja') {
            dbLang = 'ja';
        }

        // Calculate pagination
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        // Parse orderBy (e.g., '-releaseDate' => order by release_date DESC)
        const isDescending = orderBy.startsWith('-');
        const field = isDescending ? orderBy.substring(1) : orderBy;
        const dbField = field === 'releaseDate' ? 'release_date' : field;

        // Query Supabase
        const { data: sets, error, count } = await supabase
            .from('pokemon_sets')
            .select('*', { count: 'exact' })
            .eq('language', dbLang)
            .order(dbField, { ascending: !isDescending })
            .range(from, to);

        if (error) {
            throw new Error(`Supabase Error: ${error.message}`);
        }

        // Transform to match Pokemon TCG API format
        const transformedData = (sets || []).map(s => ({
            id: s.id,
            name: s.name,
            series: s.series,
            printedTotal: s.printed_total,
            total: s.total,
            releaseDate: s.release_date,
            updatedAt: s.updated_at,
            images: {
                symbol: s.symbol_url,
                logo: s.logo_url
            }
        }));

        return NextResponse.json({
            data: transformedData,
            page,
            pageSize,
            count: transformedData.length,
            totalCount: count || 0
        }, {
            headers: {
                'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=59',
            },
        });
    } catch (error: any) {
        console.error('Sets API error:', error);
        return NextResponse.json({
            error: error.message,
            data: [],
            totalCount: 0
        }, { status: 500 });
    }
}
