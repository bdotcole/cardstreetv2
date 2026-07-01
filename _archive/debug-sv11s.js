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

async function debugSV11s() {
    console.log('--- Debugging SV11s ---');

    // 1. Get sample SV11s cards
    const { data: sv11s, error: e1 } = await supabase
        .from('pokemon_cards')
        .select('id, name, english_name, rarity, number')
        .eq('set_id', 'SV11s')
        .limit(5);

    if (e1) console.error('Error fetching SV11s:', e1);
    else {
        console.log(`Fetched ${sv11s.length} SV11s cards:`);
        console.table(sv11s);
    }

    // 2. Check English Sets content
    const englishSets = ['sv10.5b', 'sv10.5w'];
    for (const setId of englishSets) {
        const { count, error: e2 } = await supabase
            .from('pokemon_cards')
            .select('*', { count: 'exact', head: true })
            .eq('set_id', setId);

        console.log(`Cards in ${setId}: ${count} (Error: ${e2?.message || 'none'})`);

        // Show sample
        const { data: sample } = await supabase
            .from('pokemon_cards')
            .select('name, rarity, number')
            .eq('set_id', setId)
            .limit(3);
        console.table(sample);
    }

    // 3. Simulate Match
    if (sv11s && sv11s.length > 0) {
        const target = sv11s[0];
        console.log(`\nSimulating match for: ${target.english_name} (${target.rarity})`);

        // Try loose search
        const { data: candidates } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, rarity')
            .in('set_id', englishSets)
            .ilike('name', `%${target.english_name}%`);

        console.log('Candidates found (loose search):');
        console.table(candidates);
    }
}

debugSV11s();
