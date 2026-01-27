
import { NextRequest, NextResponse } from 'next/server';

// 24 Hour Cache for Sets (they rarely change)
export const revalidate = 86400;

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const page = searchParams.get('page') || '1';
    const pageSize = searchParams.get('pageSize') || '20';
    const orderBy = searchParams.get('orderBy') || '-releaseDate';
    const select = searchParams.get('select') || 'id,name,series,printedTotal,total,releaseDate,updatedAt,images';

    const apiUrl = `https://api.pokemontcg.io/v2/sets?page=${page}&pageSize=${pageSize}&orderBy=${orderBy}&select=${select}`;

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Accept': 'application/json',
                // 'X-Api-Key': process.env.POKEMON_TCG_API_KEY || '' // Optional if user has key
            },
            next: { revalidate: 86400 } // Cache this specific fetch for 24 hours
        });

        if (!response.ok) {
            throw new Error(`Upstream API Error: ${response.status}`);
        }

        const data = await response.json();

        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=59',
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message, data: [] }, { status: 500 });
    }
}
