import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const searchTerms = [
    'Phantasmal Flames', 'Mega Evolution', 'Black & White',
    'Rise of the Invincible', 'Destined Rivals', 'Bond of Destiny', 'Journey Together'
];

async function searchSets() {
    console.log('Searching for sets...');

    // Search for each term
    for (const term of searchTerms) {
        const { data: sets, error } = await supabase
            .from('pokemon_sets')
            .select('*')
            .ilike('name', `%${term}%`);

        if (sets && sets.length > 0) {
            console.log(`\n--- Results for "${term}" ---`);
            sets.forEach(s => console.log(JSON.stringify(s, null, 2)));
        } else {
            console.log(`\nNo results for "${term}"`);
        }
    }
}

searchSets();
