
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

async function debugFrontendFetch() {
    console.log('--- Debugging Frontend Data Fetch ---');

    // 1. Fetch a known set (e.g., MA1) like the frontend does
    // services/pokemonService.ts uses:
    // .from('pokemon_cards').select('*, set:pokemon_sets(*), market_values(*)')

    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select(`
            id, 
            name, 
            set_id,
            market_values (
                market_avg,
                last_updated
            )
        `)
        .eq('set_id', 'MA1')
        .limit(10);

    if (error) {
        console.error('Supabase Error:', error);
        return;
    }

    console.log(`Fetched ${cards.length} cards.`);

    cards.forEach(card => {
        const marketVal = Array.isArray(card.market_values) ? card.market_values[0] : card.market_values;
        const price = marketVal?.market_avg || 'N/A';
        console.log(`Card: ${card.name} (${card.id}) | Price: ${price} THB`);
    });
}

debugFrontendFetch();
