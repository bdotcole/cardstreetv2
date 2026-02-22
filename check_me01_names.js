
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

async function checkNames() {
    console.log('Fetching me01 card names...');

    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('name, number, id')
        .eq('set_id', 'me01')
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Sample cards:', cards);
}

checkNames();
