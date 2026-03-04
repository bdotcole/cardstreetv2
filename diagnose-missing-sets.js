const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
    }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'] || env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

// Current SET_ID_MAP from batch-price-english (copied for reference)
const SET_ID_MAP = {
    'sv8pt5': 'prismatic-evolutions-pokemon',
    'sv08pt5': 'surging-sparks-pokemon',
    'sv08': 'surging-sparks-pokemon',
    'sv09': 'journey-together-pokemon',
    'sv10': 'destined-rivals-pokemon',
    'sv07': 'stellar-crown-pokemon',
    'sv06': 'twilight-masquerade-pokemon',
    'sv05': 'temporal-forces-pokemon',
    'sv04.5': 'paldean-fates-pokemon',
    'sv04': 'paradox-rift-pokemon',
    'sv03.5': 'pokemon-151-pokemon',
    'sv03': 'obsidian-flames-pokemon',
    'sv02': 'paldea-evolved-pokemon',
    'sv01': 'scarlet-violet-base-set-pokemon',
    'swsh12.5': 'crown-zenith-pokemon',
    'swsh12': 'silver-tempest-pokemon',
    // (abbreviated for brevity - we only need to identify unmapped ones)
};

async function diagnose() {
    console.log('\n=== DIAGNOSING ENGLISH SET MARKET TRACKING ===\n');

    // 1. Find ALL English set IDs in the DB
    const { data: allSets, error: setsErr } = await supabase
        .from('pokemon_cards')
        .select('set_id')
        .eq('language', 'en');

    if (setsErr) { console.error('Error fetching sets:', setsErr); return; }

    const dbSetIds = [...new Set(allSets.map(r => r.set_id))].sort();
    console.log(`Found ${dbSetIds.length} unique English set IDs in DB:\n`, dbSetIds);

    // 2. Check which ones are missing from SET_ID_MAP
    const missing = dbSetIds.filter(id => !SET_ID_MAP[id]);
    console.log(`\n=== MISSING from SET_ID_MAP (${missing.length} sets) ===\n`, missing);

    // 3. Specifically check for Black Bolt, White Flare, Journey Together
    console.log('\n=== SEARCHING for specific sets by name ===');
    const { data: targetSets, error: targetErr } = await supabase
        .from('pokemon_sets')
        .select('id, name, release_date')
        .or('name.ilike.%Black Bolt%,name.ilike.%White Flare%,name.ilike.%Journey Together%,name.ilike.%Destined Rivals%,name.ilike.%Prismatic%');

    if (targetErr) { console.error('Error:', targetErr); }
    else { console.table(targetSets); }

    // 4. Check existing market_values coverage by set
    console.log('\n=== MARKET VALUE COVERAGE by English set ===');
    const { data: pricedCards, error: pricedErr } = await supabase
        .from('market_values')
        .select('card_id, language')
        .eq('language', 'en');

    const pricedIds = new Set((pricedCards || []).map(r => r.card_id));

    // Get cards per set
    for (const setId of dbSetIds) {
        const { data: setCards } = await supabase
            .from('pokemon_cards')
            .select('id')
            .eq('set_id', setId)
            .eq('language', 'en');

        const total = setCards?.length || 0;
        const priced = (setCards || []).filter(c => pricedIds.has(c.id)).length;
        const hasBatchMap = SET_ID_MAP[setId] ? '✓' : '✗ MISSING';
        console.log(`  ${setId}: ${priced}/${total} priced | JustTCG Map: ${hasBatchMap}`);
    }
}

diagnose().catch(console.error);
