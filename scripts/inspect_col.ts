import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectCollectionData() {
    const { data: items } = await supabase.from('collection_items').select('id, card_id, card_data').limit(5);
    console.log("Sample items:");
    for (const item of items || []) {
        console.log(`ID: ${item.id}, Set: ${item.card_data?.set}`);
    }
}
inspectCollectionData();
