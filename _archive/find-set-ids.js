import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
// Never hard-code the service-role key — export SUPABASE_SERVICE_ROLE_KEY (see .env.local).
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in the environment');

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
