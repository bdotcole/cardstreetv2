import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const defaultCacheControl = 'public, s-maxage=3600, stale-while-revalidate=86400';

export async function GET(request: Request, props: { params: Promise<{ setId: string }> }) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');

        const params = await props.params;
        const setId = params.setId;

        if (!setId) {
            return NextResponse.json({ error: 'Missing setId' }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // OPTIMIZATION: Only grab the fields we render on the UI
        // We drop 'raw_data' to convert a ~4MB payload per set into a ~40KB payload
        const { data: cards, error } = await supabase
            .from('pokemon_cards')
            .select('id, name, english_name, set_id, number, rarity, image_small, image_large, language, tcgplayer_url, raw_data->tcgplayer, pokemon_sets(name), market_values(market_avg, currency, last_updated)')
            .ilike('set_id', setId)
            .order('number', { ascending: true });

        if (error) {
            console.error('Supabase error fetching cards:', error);
            return NextResponse.json([], { status: 500 });
        }

        let filteredCards = cards || [];

        if (language && cards) {
            const hasJapaneseChars = (text: string) => {
                const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
                return japaneseRegex.test(text);
            };

            if (language === 'jp') {
                filteredCards = cards.filter(c => hasJapaneseChars(c.name || ''));
            } else {
                filteredCards = cards.filter(c => !hasJapaneseChars(c.name || ''));
            }
        }

        return new NextResponse(JSON.stringify(filteredCards), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': defaultCacheControl
            }
        });

    } catch (error) {
        console.error("Failed to fetch cards from API route:", error);
        return NextResponse.json([], { status: 500 });
    }
}
