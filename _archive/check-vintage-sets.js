import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSets() {
    const setNames = [
        'Gym Challenge', 'Gym Heroes', 'Skyridge', 'Southern Islands',
        'Legendary Collection', 'Expedition', 'Aquapolis'
    ];

    console.log("=== Checking Set Metadata ===");
    for (const name of setNames) {
        const { data: sets } = await supabase
            .from('pokemon_sets')
            .select('id, name, series, release_date')
            .ilike('name', `%${name}%`);

        console.log(`\nSearch for: ${name}`);
        console.table(sets || []);
    }
}

checkSets().catch(console.error);
