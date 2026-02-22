
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
    console.log('Searching for English equivalents...');

    // Look for unique names in me01 that are clearly Regulation I
    // "Mega Lucario ex" (lowercase ex implies modern, uppercase EX is old XY)
    // "Mega Gardevoir ex"

    const names = ['Mega Lucario ex', 'Mega Gardevoir ex'];

    const { data: engCards } = await supabase
        .from('pokemon_cards')
        .select('*')
        .in('name', names)
        .eq('language', 'en');

    if (engCards && engCards.length > 0) {
        console.log('Found English cards:', JSON.stringify(engCards, null, 2));
    } else {
        console.log('No direct English Name matches found for modern Mega ex.');
        // Try fuzzy "Lucario" and "ex" logic?
        // Or search for recent sets
    }

    // Also check what 'me01' actually contains
    const { data: meCards } = await supabase
        .from('pokemon_cards')
        .select('name, number, rarity, raw_data')
        .eq('set_id', 'me01')
        .limit(5);
    console.log('Sample me01 cards:', JSON.stringify(meCards, null, 2));

}

check();
