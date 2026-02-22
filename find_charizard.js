
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
    console.log('Searching for Mega Charizard X ex...');

    // Search by name
    const { data: cards } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, number')
        .ilike('name', '%Mega Charizard X ex%')
        .order('set_id');

    console.log('Found cards:', cards);

    if (cards.length > 0) {
        // Check market values for these cards
        const ids = cards.map(c => c.id);
        const { data: prices } = await supabase
            .from('market_values')
            .select('*')
            .in('card_id', ids);

        console.log('Existing prices:', prices);
    }
}

check();
