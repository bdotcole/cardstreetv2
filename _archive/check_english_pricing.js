
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

async function checkEnglishPricing() {
    console.log('--- Checking Market Values for English Set me02 ---');

    // Get some cards from me02
    const { data: cards } = await supabase.from('pokemon_cards').select('id, name').eq('set_id', 'me02').limit(5);

    if (cards && cards.length > 0) {
        const cardIds = cards.map(c => c.id);
        const { data: prices } = await supabase.from('market_values').select('*').in('card_id', cardIds);

        console.log('Cards:', cards);
        console.log('Prices:', prices);
    } else {
        console.log('No cards found in me02.');
    }
}

checkEnglishPricing();
