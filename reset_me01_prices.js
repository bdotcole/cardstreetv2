
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

async function reset() {
    console.log('Fetching me01 cards...');

    // Get card IDs
    const { data: cards, error: fetchError } = await supabase
        .from('pokemon_cards')
        .select('id')
        .eq('set_id', 'me01');

    if (fetchError) {
        console.error('Error fetching cards:', fetchError);
        return;
    }

    const cardIds = cards.map(c => c.id);
    console.log(`Found ${cardIds.length} cards in me01.`);

    if (cardIds.length === 0) return;

    // Delete market values in chunks to avoid URL length limits if passed in URL (though post body shouldn't have this, safety first)
    const chunkSize = 200;
    console.log(`Deleting market values for ${cardIds.length} cards...`);

    let deletedCount = 0;
    for (let i = 0; i < cardIds.length; i += chunkSize) {
        const chunk = cardIds.slice(i, i + chunkSize);
        const { error: deleteError, count } = await supabase
            .from('market_values')
            .delete({ count: 'exact' })
            .in('card_id', chunk);

        if (deleteError) {
            console.error('Error deleting chunk:', deleteError);
        } else {
            // count might be null depending on headers/version, usually returns null for delete unless specified
            process.stdout.write('.');
        }
    }
    console.log('\nFinished deleting.');
}

reset();
