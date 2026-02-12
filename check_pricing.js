
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPricing() {
    console.log('--- Checking Market Values for MA2 (Mega Heracross ex) ---');

    // Find "Mega Heracross ex" card
    const { data: cards } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, number')
        .eq('set_id', 'MA2')
        .ilike('name', '%Heracross%');

    if (!cards || cards.length === 0) {
        console.log('No Heracross found in MA2.');
    } else {
        const cardIds = cards.map(c => c.id);

        // Get market values
        const { data: prices } = await supabase
            .from('market_values')
            .select('*')
            .in('card_id', cardIds);

        console.log('Cards:', cards);
        console.log('Prices:', prices);
    }

    console.log('\n--- Checking for $5 Default Values ---');
    const { count, error } = await supabase
        .from('market_values')
        .select('*', { count: 'exact', head: true })
        .eq('market_avg', 5);

    console.log(`Count of market_values with exactly 5: ${count}`);
}

checkPricing();
