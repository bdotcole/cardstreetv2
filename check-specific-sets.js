import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSets() {
    console.log("=== Checking Set Metadata ===");
    const { data: sets } = await supabase
        .from('pokemon_sets')
        .select('id, name, series, release_date')
        .or('name.ilike.%Prismatic%,name.ilike.%Shrouded Fable%');

    console.table(sets);

    if (sets) {
        for (const set of sets) {
            console.log(`\n=== Checking Cards for ${set.name} (${set.id}) ===`);
            const { data: cards } = await supabase
                .from('pokemon_cards')
                .select('id, name, language, set_id')
                .eq('set_id', set.id)
                .limit(5);

            const { count: cardCount } = await supabase
                .from('pokemon_cards')
                .select('id', { count: 'exact', head: true })
                .eq('set_id', set.id);

            console.log(`Total Cards: ${cardCount}`);
            if (cards && cards.length > 0) {
                console.table(cards);
            }

            console.log(`\n=== Checking Market Prices for ${set.name} ===`);
            const { data: prices } = await supabase
                .from('market_values')
                .select('card_id, market_avg, currency, updated_at')
                .in('card_id', (cards || []).map(c => c.id))
                .limit(5);

            if (prices && prices.length > 0) {
                console.table(prices);
            } else {
                console.log("No market prices found for the sampled cards.");
            }
        }
    }
}

checkSets().catch(console.error);
