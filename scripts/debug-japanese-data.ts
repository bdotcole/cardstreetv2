import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load env vars
const envLocal = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocal)) {
    const envConfig = dotenv.parse(fs.readFileSync(envLocal));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABAS_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugJapaneseData() {
    console.log('--- Debugging Japanese Data ---');

    // 1. Fetch a few Japanese Sets
    const { data: sets, error: setsError } = await supabase
        .from('pokemon_sets')
        .select('id, name, sequence_number, language, logo_url')
        .eq('language', 'ja')
        .limit(5);

    if (setsError) {
        console.error('Error fetching sets:', setsError);
        return;
    }

    console.log(`Found ${sets.length} Japanese sets:`);
    sets.forEach(s => console.log(` - [${s.id}] ${s.name} (Logo: ${s.logo_url ? 'Yes' : 'No'})`));

    if (sets.length === 0) {
        console.log('No Japanese sets found. Exiting.');
        return;
    }

    // 2. Take the first set and try to find cards
    const testSet = sets[0];
    console.log(`\nChecking cards for Set: [${testSet.id}] ${testSet.name}`);

    const { data: cards, error: cardsError } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, number, language')
        .eq('set_id', testSet.id);

    if (cardsError) {
        console.error('Error fetching cards:', cardsError);
        return;
    }

    console.log(`Found ${cards.length} cards matching set_id='${testSet.id}'`);
    if (cards.length > 0) {
        console.log('Sample card:', cards[0]);
    } else {
        // 3. If no cards found, check if there are ANY Japanese cards and what their set_ids look like
        console.log('No cards found for this set ID. Checking random Japanese cards...');
        const { data: randomCards } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, number, language')
            .eq('language', 'ja')
            .limit(5);

        console.log('Random Japanese cards in DB:');
        randomCards.forEach(c => console.log(` - Card [${c.id}] SetID: '${c.set_id}' Name: ${c.name}`));
    }
}

debugJapaneseData().catch(console.error);
