
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('Fetching me02 cards...');
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id')
        .eq('set_id', 'me02');

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    console.log(`Found ${cards.length} cards in me02.`);

    if (cards.length === 0) return;

    const cardIds = cards.map(c => c.id);
    console.log(`Deleting market values for ${cardIds.length} cards...`);

    // Delete in chunks
    const chunkSize = 100;
    for (let i = 0; i < cardIds.length; i += chunkSize) {
        const chunk = cardIds.slice(i, i + chunkSize);
        const { error: delError } = await supabase
            .from('market_values')
            .delete()
            .in('card_id', chunk);

        if (delError) console.error('Error deleting chunk:', delError);
        else process.stdout.write('.');
    }
    console.log('\nFinished deleting.');
}

run();
