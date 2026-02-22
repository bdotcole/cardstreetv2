import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkState() {
    const { data: items } = await supabase.from('collection_items').select('*');
    if (!items) return;

    console.log(`User has ${items.length} cards in their collection_items overall.`);

    const duplicateIds = new Set();
    const map = new Map();
    items.forEach(i => {
        if (map.has(i.card_id)) duplicateIds.add(i.card_id);
        map.set(i.card_id, i);
    });

    if (duplicateIds.size > 0) {
        console.log("Found duplicate card entries:");
        items.filter(i => duplicateIds.has(i.card_id)).forEach(i => {
            console.log(`- Card ID: ${i.card_id}, Added: ${i.created_at}, Purchase Price: ${i.purchase_price}`);
        });
    } else {
        console.log("No duplicate cards found.");
        // How did portfolio value increase?
        console.log("Looking at the specific card from the order (MA3-246).");
        items.filter(i => i.card_id === 'MA3-246').forEach(i => {
            console.log(`- Card ID: ${i.card_id}, Quantity: ${i.quantity}, Price: ${i.purchase_price}, Added: ${i.created_at}`);
        });
    }
}
checkState();
