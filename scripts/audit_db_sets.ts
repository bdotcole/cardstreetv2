import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function auditDatabase() {
    // 1. What Thai sets are currently in the database?
    const { data: thaiSets } = await supabase
        .from('pokemon_sets')
        .select('id, name, language')
        .eq('language', 'th')
        .order('id');

    console.log('\n=== THAI SETS IN DATABASE ===');
    thaiSets?.forEach(s => console.log(`  ${s.id}: ${s.name}`));

    // 2. How many cards per Thai set?
    console.log('\n=== CARDS PER THAI SET ===');
    const thaiSetIds = thaiSets?.map(s => s.id) || [];
    for (const setId of thaiSetIds) {
        const { count } = await supabase
            .from('pokemon_cards')
            .select('id', { count: 'exact', head: true })
            .eq('set_id', setId);
        console.log(`  ${setId}: ${count} cards`);
    }

    // 3. Does the set_bridge table exist?
    const { data: bridge, error: bridgeError } = await supabase
        .from('set_bridge' as any)
        .select('*')
        .limit(1);

    console.log('\n=== SET_BRIDGE TABLE ===');
    if (bridgeError) {
        console.log('  Does NOT exist:', bridgeError.message);
    } else {
        console.log('  EXISTS, sample:', JSON.stringify(bridge));
    }

    // 4. What English sets do we have that are relevant?
    const englishSetsOfInterest = [
        'twilight-masquerade', 'sv6', 'sv5', 'temporal-forces', 'sv5m',
        'paradox-rift', 'sv4pt5', 'paldean-fates', 'obsidian-flames', 'sv3',
        'pokemon151', 'sv2pt5', 'paldea-evolved', 'sv2', 'scarlet-violet', 'sv1',
        'prismatic-evolutions', 'sv8pt5', 'stellar-crown', 'sv7',
        'destined-rivals', 'journey-together',
        'sv8a', 'sv8s', 'sv7s', 'sv6th', 'sv5a', 'sv5m', 'sv5k'
    ];

    const { data: enSets } = await supabase
        .from('pokemon_sets')
        .select('id, name, language')
        .eq('language', 'en')
        .order('id');

    console.log('\n=== ALL ENGLISH SETS IN DATABASE ===');
    enSets?.forEach(s => console.log(`  ${s.id}: ${s.name}`));
}

auditDatabase();
