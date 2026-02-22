require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPrices() {
    console.log('Checking for English card prices in market_values...');

    // 1. Get specific English card ID from loop log
    const specificId = 'me01-116';
    console.log(`Checking specific card: ${specificId}`);

    const { data: specificPrice, error: specError } = await supabase
        .from('market_values')
        .select('*')
        .eq('card_id', specificId);

    if (specError) {
        console.error('Error fetching specific price:', specError);
    } else if (specificPrice && specificPrice.length > 0) {
        console.log(`FOUND PRICE for ${specificId}:`, specificPrice[0]);
    } else {
        console.log(`NO PRICE FOUND for ${specificId}`);
    }

    // 1. Get some English card IDs (keep original check too)
    const { data: cards, error: cardError } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id')
        .eq('language', 'en')
        .limit(10);

    if (cardError) {
        console.error('Error fetching cards:', cardError);
        return;
    }

    console.log(`Found ${cards.length} English cards to check.`);

    // 2. Check if they have prices
    const cardIds = cards.map(c => c.id);
    const { data: prices, error: priceError } = await supabase
        .from('market_values')
        .select('card_id, market_avg, currency, last_updated')
        .in('card_id', cardIds);

    if (priceError) {
        console.error('Error fetching prices:', priceError);
        return;
    }

    console.log(`Found ${prices.length} price entries for these cards.`);
    prices.forEach(p => {
        console.log(`- Card ${p.card_id}: ${p.market_avg} ${p.currency} (Updated: ${p.last_updated})`);
    });

    // 3. Specific check for me02-125 (common test case)
    const { data: specCard } = await supabase
        .from('pokemon_cards')
        .select('id, name')
        .ilike('name', 'Mewtwo')
        .eq('set_id', 'me02')
        .limit(1);

    if (specCard && specCard.length > 0) {
        const id = specCard[0].id;
        const { data: specPrice } = await supabase
            .from('market_values')
            .select('*')
            .eq('card_id', id);
        console.log(`\nSpecific check for Mewtwo (me02): Found ${specPrice?.length || 0} entries.`);
        if (specPrice?.length > 0) console.log(specPrice[0]);
    }

}

checkPrices();
