
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

async function inspectDB() {
    console.log('--- Sets named "Phantasmal" ---');
    const { data: sets } = await supabase.from('pokemon_sets').select('*').ilike('name', '%Phantasmal%');
    console.log(sets);

    if (sets && sets.length > 0) {
        const setId = sets[0].id;
        console.log(`\n--- First 5 Cards in Set ${setId} ---`);
        const { data: cards } = await supabase.from('pokemon_cards').select('id, name').eq('set_id', setId).limit(5);
        console.log(cards);
    }
}

inspectDB();
