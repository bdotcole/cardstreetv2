import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSets() {
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, pokemon_sets(name)')
        .eq('set_id', 'MA3')
        .limit(2);

    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Cards:", JSON.stringify(cards, null, 2));
    }
}

checkSets();
