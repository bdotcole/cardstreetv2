
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkHighValueCards() {
    console.log('--- Checking High Value Cards (SR/SAR) ---');

    // 1. Find some Secret Rares from MA1 (Thai set)
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select(`
            id, 
            name, 
            rarity,
            card_mappings!card_mappings_card_id_th_fkey (
                card_id_en,
                match_method,
                confidence_score
            ),
            market_values (
                market_avg,
                source_prices
            )
        `)
        .eq('set_id', 'MA1')
        .in('rarity', ['Secret Rare', 'Hyper Rare', 'Special Art Rare'])
        .limit(5);

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    if (!cards || cards.length === 0) {
        console.log('No SR/SAR cards found in MA1 sample.');
        return;
    }

    cards.forEach(card => {
        console.log(`\nCard: ${card.name} (${card.id}) - ${card.rarity}`);

        const mapping = Array.isArray(card.card_mappings) ? card.card_mappings[0] : card.card_mappings;
        if (mapping) {
            console.log(`  Matched to English: ${mapping.card_id_en} (Method: ${mapping.match_method})`);
        } else {
            console.log(`  NO MAPPING FOUND`);
        }

        const market = Array.isArray(card.market_values) ? card.market_values[0] : card.market_values;
        if (market) {
            console.log(`  Price: ${market.market_avg} THB`);
            console.log(`  Details:`, JSON.stringify(market.source_prices));
        } else {
            console.log(`  NO PRICE DATA`);
        }
    });
}

checkHighValueCards();
