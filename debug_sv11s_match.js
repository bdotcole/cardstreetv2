
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSV9s() {
    console.log('--- Debugging SV9s Unmapped Cards ---');

    // 1. Get unmapped SV9s cards
    // First get all mappings to exclude
    const { data: mappings } = await supabase.from('card_mappings').select('card_id_th');
    const mappedIds = new Set(mappings.map(m => m.card_id_th));

    // Get SV9s cards
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('*')
        .eq('set_id', 'SV9s')
        .eq('language', 'th')
        .limit(50);

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    const unmapped = cards.filter(c => !mappedIds.has(c.id)).slice(0, 5);

    if (unmapped.length === 0) {
        console.log('No unmapped SV9s cards found in first 50 fetched.');
        return;
    }

    console.log(`Analyzing ${unmapped.length} unmapped cards from SV9s...`);

    for (const card of unmapped) {
        console.log(`\n--------------------------------------------------`);
        console.log(`Checking Card: ${card.name} (${card.id})`);
        console.log(`  English Name: "${card.english_name}"`);
        console.log(`  Rarity: "${card.rarity}"`);
        console.log(`  Set ID: "${card.set_id}"`);

        if (!card.english_name) {
            console.log('  -> SKIPPING: No English Name');
            continue;
        }

        // Target set for SV9s is 'sv09'
        const targetSetIds = ['sv09'];

        // Check if target sets exist
        const { data: checkSets } = await supabase
            .from('pokemon_sets')
            .select('id, name, release_date')
            .in('id', targetSetIds);

        console.log('  Target Sets in DB:', checkSets);

        // Try to find potential matches
        const { data: potentialMatches } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, rarity')
            .eq('language', 'en')
            .ilike('name', card.english_name.trim())
            .in('set_id', targetSetIds);

        console.log('  Potential Matches (Strict Set + Name):', potentialMatches);

        if (!potentialMatches || potentialMatches.length === 0) {
            // Try relaxed search (any set)
            const { data: relaxedMatches } = await supabase
                .from('pokemon_cards')
                .select('id, name, set_id, rarity')
                .eq('language', 'en')
                .ilike('name', card.english_name.trim())
                .limit(5);
            console.log('  Potential Matches (Any Set + Name):', relaxedMatches);
        }
    }
}

debugSV9s();
