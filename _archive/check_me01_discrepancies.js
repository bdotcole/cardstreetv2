
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const anonKeyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

if (!anonKeyMatch || !urlMatch) {
    console.error('Could not parse .env.local');
    process.exit(1);
}

const supabase = createClient(urlMatch[1], anonKeyMatch[1]);

async function check() {
    console.log('Checking discrepancies in me01...');

    // Fetch Cards
    const { data: cards, error: cardError } = await supabase
        .from('pokemon_cards')
        .select('id, name, number, set_id')
        .in('name', ['Bulbasaur', 'Ivysaur', 'Mega Venusaur ex'])
        .eq('set_id', 'me01');

    console.log('Cards Metadata:', JSON.stringify(cards, null, 2));

    if (cards && cards.length > 0) {
        const ids = cards.map(c => c.id);
        const { data: prices } = await supabase
            .from('market_values')
            .select('*')
            .in('card_id', ids);

        console.log('Current Prices:', JSON.stringify(prices, null, 2));
    }
}

check();
