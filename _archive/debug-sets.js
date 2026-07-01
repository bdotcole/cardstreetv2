const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of require('fs').readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
}
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function debugSets() {
    console.log('--- Debugging Sets ---');

    // 1. Check if target sets exist
    const { data: sets, error: e1 } = await supabase
        .from('pokemon_sets')
        .select('id, name, release_date')
        .in('id', ['me01', 'me02', 'sv09', 'sv10']);

    if (e1) console.error('Error fetching sets:', e1);
    else console.table(sets);

    // 2. Check unmapped MA1 cards
    const { data: ma1Cards, error: e2 } = await supabase
        .from('pokemon_cards')
        .select('id, name, english_name, rarity, number')
        .eq('set_id', 'MA1')
        .limit(5);

    if (e2) console.error('Error fetching MA1 cards:', e2);
    else {
        console.log('\n--- Sample MA1 Cards ---');
        console.table(ma1Cards);
    }

    // 3. Check me01 cards that SHOULD match
    // Check for "Venusaur ex" which should be in MA1 and me01
    const { data: me01Cards, error: e3 } = await supabase
        .from('pokemon_cards')
        .select('id, name, rarity, number')
        .eq('set_id', 'me01')
        .limit(10);

    if (e3) console.error('Error fetching me01 cards:', e3);
    else {
        console.log('\n--- Sample me01 Cards ---');
        console.table(me01Cards);
    }

    // 4. Try exact match query simulation for one card
    if (ma1Cards && ma1Cards.length > 0) {
        const sample = ma1Cards[0];
        console.log(`\n--- Simulating Match for: ${sample.english_name} (${sample.rarity}) ---`);

        const { data: candidates } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, rarity')
            .eq('language', 'en')
            .ilike('name', sample.english_name)
            .eq('set_id', 'me01'); // Force check against target set

        console.log('Direct candidates in me01:', candidates);
    }
}

debugSets();
