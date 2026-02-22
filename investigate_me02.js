
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const idsToCheck = ['me02-011', 'me02-012', 'me02-017', 'me02-128'];

    console.log('--- Metadata Check ---');
    const { data: cards } = await supabase
        .from('pokemon_cards')
        .select('*')
        .in('id', idsToCheck);

    for (const card of cards) {
        console.log(`[${card.id}] ${card.name} (#${card.number}) - Rarity: ${card.rarity}, Set: ${card.set_id}`);
    }

    console.log('\n--- Price Check ---');
    const { data: prices } = await supabase
        .from('market_values')
        .select('*')
        .in('card_id', idsToCheck);

    for (const p of prices) {
        console.log(`[${p.card_id}] ${p.market_avg} THB ($${(p.market_avg / 35.85).toFixed(2)}) - Method: ${p.source_prices?.method} - Updated: ${p.last_updated}`);
    }

    // Search for Charmander Flashfire specifically
    const url = `https://api.justtcg.com/v1/cards/search?q=Charmander&game=pokemon&language=en`;
    try {
        const response = await fetch(url, { method: 'GET', headers: { 'x-api-key': 'tcg_321c4596652b46d19de533a7518912ca' } });
        const data = await response.json();
        const flashfire = data.data.find(c => c.name.includes('Flashfire') || c.id.includes('flashfire'));
        if (flashfire) {
            console.log(`Found Charmander Flashfire: ${flashfire.id}`);
        } else {
            console.log('Charmander Flashfire not found in search results.');
        }
    } catch (e) { }
}

run();
