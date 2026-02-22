import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDoubleListings() {
    // There are 2 listings with same seller, card_id, price. Let's see if there are others.
    const { data: listings } = await supabase.from('listings').select('id, card_id, created_at, seller_id').order('card_id');
    console.log(`Total listings: ${listings?.length}`);

    // Group by
    const groups: Record<string, any[]> = {};
    for (const l of listings || []) {
        const key = `${l.seller_id}_${l.card_id}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(l);
    }

    for (const [k, v] of Object.entries(groups)) {
        if (v.length > 1) {
            console.log(`DUPLICATE FOR ${k}:`);
            v.forEach(x => console.log(`  - ${x.id} at ${x.created_at}`));
        }
    }
}

checkDoubleListings();
