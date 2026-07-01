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

async function analyze() {
    console.log('--- Analyzing Unmapped SV11s Cards ---');

    // 1. Get already mapped IDs
    const { data: mapped } = await supabase
        .from('card_mappings')
        .select('card_id_th');
    const mappedIds = new Set(mapped.map(m => m.card_id_th));

    // 2. Get All SV11s Cards
    const { data: allSv11s } = await supabase
        .from('pokemon_cards')
        .select('*')
        .eq('set_id', 'SV11s');

    const unmapped = allSv11s.filter(c => !mappedIds.has(c.id));
    console.log(`Total SV11s: ${allSv11s.length}`);
    console.log(`Mapped: ${allSv11s.length - unmapped.length}`);
    console.log(`Unmapped: ${unmapped.length}`);

    if (unmapped.length === 0) return;

    // 3. Analyze a batch of unmapped cards
    console.log('\n--- Sample Unmapped Cards Analysis ---');
    const sample = unmapped.slice(0, 10);

    for (const card of sample) {
        console.log(`\nChecking: ${card.english_name} (${card.name}) - ${card.rarity}`);

        // Search in English sets
        const { data: exactMatches } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, rarity')
            .in('set_id', ['sv10.5b', 'sv10.5w'])
            .ilike('name', card.english_name.trim());

        if (exactMatches && exactMatches.length > 0) {
            console.log(`  ! Found exact name match but failed strict criteria?`);
            console.table(exactMatches);
        } else {
            console.log(`  x No exact name match in sv10.5b/w.`);

            // Try fuzzy search to see if it's a spelling/suffix issue
            const { data: fuzzy } = await supabase
                .from('pokemon_cards')
                .select('id, name, set_id, rarity')
                .in('set_id', ['sv10.5b', 'sv10.5w'])
                .ilike('name', `%${card.english_name.split(' ')[0]}%`)
                .limit(3);

            if (fuzzy && fuzzy.length > 0) {
                console.log(`  ? Potential fuzzy matches:`);
                console.table(fuzzy);
            }
        }
    }
}

analyze();
