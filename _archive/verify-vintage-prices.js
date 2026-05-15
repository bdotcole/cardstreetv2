import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyPrices() {
    const setsToSync = ['gym2', 'gym1', 'ecard3', 'si1', 'lc', 'ecard1', 'ecard2'];

    console.log("=== Verifying Market Prices for Vintage Sets ===\n");

    for (const setId of setsToSync) {
        // Get all EN cards for set
        const { data: cards } = await supabase
            .from('pokemon_cards')
            .select('id')
            .eq('set_id', setId)
            .eq('language', 'en');

        if (!cards || cards.length === 0) {
            console.log(`[${setId}] 0 EN cards found in database.`);
            continue;
        }

        const cardIds = cards.map(c => c.id);

        // Check market_values
        const { count: pricedCount } = await supabase
            .from('market_values')
            .select('card_id', { count: 'exact', head: true })
            .in('card_id', cardIds)
            .gt('market_avg', 0);

        console.log(`[${setId}] Found ${pricedCount} / ${cards.length} cards with market prices.`);
    }
}

verifyPrices().catch(console.error);
