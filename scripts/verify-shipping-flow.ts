import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
    console.log('--- Verifying Database Schema ---');
    
    // Check if columns exist in orders
    const { data: columns, error: colError } = await supabase.rpc('inspect_table_columns', { table_name: 'orders' });
    
    // Since I don't have inspect_table_columns RPC, I'll try to fetch an order and check keys
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .limit(1)
        .single();

    if (orderError) {
        if (orderError.code === 'PGRST116') {
            console.log('No orders found, but table exists.');
        } else {
            console.error('Error fetching order:', orderError);
        }
    } else {
        console.log('Order columns found:', Object.keys(order));
        if (Object.keys(order).includes('shipping_amount')) {
            console.log('✅ shipping_amount column exists');
        } else {
            console.log('❌ shipping_amount column MISSING');
        }
    }

    console.log('\n--- Verifying Notification Preferences ---');
    const { data: prefs, error: prefError } = await supabase
        .from('notification_preferences')
        .select('*')
        .limit(1);
    
    if (prefError) {
        console.error('Error fetching notification preferences:', prefError);
    } else {
        console.log('Notification preferences table exists and has', prefs.length, 'records.');
    }
}

verify();
