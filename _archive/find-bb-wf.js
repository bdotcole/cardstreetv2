const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function findSetIds() {
    console.log('Searching for Black Bolt / White Flare...');

    const { data: sets, error } = await supabase
        .from('pokemon_sets')
        .select('id, name, release_date')
        .or('name.ilike.%Black Bolt%,name.ilike.%White Flare%'); // Search both

    if (error) {
        console.error('Error:', error);
    } else {
        console.table(sets);
    }
}

findSetIds();
