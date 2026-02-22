import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspect() {
    const userId = 'ea16a6bd-bda7-4a54-9d12-8373046705f3'; // known user id from previous logs

    const { data: collections } = await supabase
        .from('collections')
        .select('id')
        .eq('user_id', userId);

    if (!collections || collections.length === 0) {
        console.log("No collections found for user");
        return;
    }

    const collectionIds = collections.map(c => c.id);

    const { data: items, error } = await supabase
        .from('collection_items')
        .select('*')
        .in('collection_id', collectionIds);

    if (error) {
        console.error("Error fetching items:", error);
        return;
    }

    console.log(`Found ${items?.length} items for user.`);
    if (items) {
        items.forEach(item => {
            console.log(`\nItem ID: ${item.id}`);
            console.log(`Card ID: ${item.card_id}`);
            console.log(`Condition: ${item.condition}`);
            console.log(`Quantity: ${item.quantity}`);
            console.log(`Purchase Price: ${item.purchase_price}`);
            console.log(`Listed?: ${item.is_listing}`);
            console.log(`Card Data Market Price:`, item.card_data?.marketPrice);
        });
    }
}

inspect();
