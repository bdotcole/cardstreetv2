
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
    console.log('Checking me01 cards...');

    // Get total count
    const { count, error: countError } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('set_id', 'me01');

    if (countError) {
        console.error('Error counting:', countError);
        return;
    }
    console.log(`Total me01 cards: ${count}`);

    // Get priced count
    const { data: cards } = await supabase
        .from('pokemon_cards')
        .select('id, name')
        .eq('set_id', 'me01');

    const cardIds = cards.map(c => c.id);

    const { data: prices, error: priceError } = await supabase
        .from('market_values')
        .select('card_id, market_avg, source_prices')
        .in('card_id', cardIds);

    if (priceError) {
        console.error('Error fetching prices:', priceError);
        return;
    }

    console.log(`Priced me01 cards: ${prices.length}`);

    const unpricedCount = count - prices.length;
    console.log(`Unpriced me01 cards: ${unpricedCount}`);

    if (prices.length > 0) {
        console.log('Sample pricing:', prices[0]);
    }
}

check();
