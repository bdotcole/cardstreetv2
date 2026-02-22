require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data: cards } = await supabase.from('pokemon_cards').select('set_id, raw_data').limit(2);
    console.log("Cards sample:", JSON.stringify(cards, null, 2));

    const { data: sets } = await supabase.from('pokemon_sets').select('*').limit(2);
    console.log("Sets sample:", JSON.stringify(sets, null, 2));
}

check();
