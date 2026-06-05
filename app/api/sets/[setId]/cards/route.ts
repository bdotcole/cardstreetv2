import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const defaultCacheControl = 'public, s-maxage=300, stale-while-revalidate=3600';

export async function GET(request: Request, props: { params: Promise<{ setId: string }> }) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        const game = searchParams.get('game') || 'pokemon';

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
            .select('id, name, english_name, set_id, number, rarity, game, image_small, image_large, language, tcgplayer_url, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(market_avg, currency, last_updated)')
            .eq('set_id', setId)
            .order('number', { ascending: true });

        if (error) {
            console.error('Supabase error fetching cards:', error);
            return NextResponse.json([], { status: 500 });
        }

        let filteredCards = cards || [];

        // Pokemon needs language disambiguation within a set (en/jp/th prints can
        // share a set row space). Other games are single-language per set, so the
        // set_id filter alone is sufficient.
        if (game === 'pokemon' && language && cards) {
            const hasJapaneseChars = (text: string) => {
                const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
                return japaneseRegex.test(text);
            };

            if (language === 'jp') {
                filteredCards = cards.filter(c => c.language === 'ja' || hasJapaneseChars(c.name || ''));
            } else if (language === 'th') {
                // Strict: Thai mode only shows language='th' rows. The old permissive
                // filter (also include any non-Japanese card) let English-print rows
                // from sets like me02.5 leak in when a race condition pinned the stale
                // setId during a language switch — those rows carry English rarity
                // strings, breaking the Thai-rarity normalization in cardMapper.
                filteredCards = cards.filter(c => c.language === 'th');
            } else {
                filteredCards = cards.filter(c => c.language === 'en' || (!hasJapaneseChars(c.name || '') && c.language !== 'ja' && c.language !== 'th'));
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
