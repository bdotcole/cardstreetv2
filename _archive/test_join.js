
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testJoin() {
    console.log('Testing Join for me01-116...');

    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, market_values(market_avg, last_updated)')
        .eq('id', 'me01-116');

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Data:', JSON.stringify(cards, null, 2));
    }
}

testJoin();
