
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

async function checkSets() {
    console.log('--- Checking Set IDs ---');

    const setsToCheck = ['me01', 'me02', 'sv3pt5', 'sv2', 'sv03.5', '151'];

    for (const setId of setsToCheck) {
        const { count, error } = await supabase
            .from('pokemon_cards')
            .select('*', { count: 'exact', head: true })
            .eq('set_id', setId);

        console.log(`Set ${setId}: ${count} cards found.`);
    }

    // Check one card from me01 if it exists
    const { data: meCard } = await supabase.from('pokemon_cards').select('id, name').eq('set_id', 'me01').limit(1);
    if (meCard && meCard.length > 0) console.log('Sample me01 card:', meCard[0]);

    // Check one card from sv3pt5 if it exists
    const { data: svCard } = await supabase.from('pokemon_cards').select('id, name').eq('set_id', 'sv3pt5').limit(1);
    if (svCard && svCard.length > 0) console.log('Sample sv3pt5 card:', svCard[0]);
}

checkSets();
