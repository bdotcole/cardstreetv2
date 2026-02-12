const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';

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
