import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testInsert() {
    console.log("Testing order insertion...");
    const { data: listings, error: listingError } = await supabase.from('listings').select('*').limit(1);

    if (!listings || listings.length === 0) {
        console.log("No listings found to test with.");
        return;
    }

    const item = listings[0];
    const buyerId = '00000000-0000-0000-0000-000000000000'; // dummy uuid

    const order = {
        listing_id: item.id,
        buyer_id: buyerId,
        seller_id: item.seller_id,
        status: 'paid',
        total_amount: item.price || 5000,
        platform_fee: (item.price || 5000) * 0.05,
        escrow_status: 'held',
        payment_method: 'credit_card',
        payment_id: 'mock_payment_id',
    };

    const { error } = await supabase.from('orders').insert(order);
    if (error) {
        console.error("Insert Error:", JSON.stringify(error, null, 2));
    } else {
        console.log("Insert Success!");
    }
}

testInsert();
