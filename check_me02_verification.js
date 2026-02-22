
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data: topCards } = await supabase
        .from('market_values')
        .select('card_id, market_avg, source_prices')
        .like('card_id', 'me02-%')
        .order('market_avg', { ascending: false })
        .limit(5);

    console.log('--- me02 Top Priced ---');
    if (topCards && topCards.length > 0) {
        for (const p of topCards) {
            const { data: card } = await supabase.from('pokemon_cards').select('name, number').eq('id', p.card_id).single();
            if (card) {
                console.log(`[${card.number}] ${card.name}: ${p.market_avg} THB ($${(p.market_avg / 35.85).toFixed(2)})`);
            }
        }
    } else {
        console.log('No prices found yet.');
    }
}

run();
