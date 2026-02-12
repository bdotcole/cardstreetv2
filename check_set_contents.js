
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

async function checkSetContents() {
    console.log('--- Checking SV03.5 (151) ---');
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, rarity')
        .eq('set_id', 'sv03.5')
        .limit(5);

    if (cards) {
        console.log(cards);
    } else {
        console.log('Error:', error);
    }

    console.log('--- Checking SV02 (Paldea Evolved?) ---');
    const { count: sv2Count } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('set_id', 'sv02');
    console.log(`sv02 count: ${sv2Count}`);

    // Check sv2 contents
    const { data: sv2Cards } = await supabase
        .from('pokemon_cards')
        .select('id, name, rarity')
        .eq('set_id', 'sv02')
        .limit(3);
    console.log(sv2Cards);
}

checkSetContents();
