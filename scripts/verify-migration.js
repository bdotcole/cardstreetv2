require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
    console.log('Running migration...');
    
    // Add stripe_account_id to profiles
    const { error: err1 } = await supabase.rpc('exec_sql', {
        query: "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;"
    });
    
    if (err1) {
        // rpc might not exist, try raw query via REST
        console.log('RPC not available, trying direct column check...');
    }

    // Test if columns exist by trying to select them
    const { data: profileTest, error: profileErr } = await supabase
        .from('profiles')
        .select('stripe_account_id')
        .limit(1);

    if (profileErr) {
        console.log('❌ profiles.stripe_account_id does NOT exist:', profileErr.message);
        console.log('   → You need to run this in the Supabase SQL Editor:');
        console.log('   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;');
    } else {
        console.log('✅ profiles.stripe_account_id EXISTS');
    }

    const { data: orderTest, error: orderErr } = await supabase
        .from('orders')
        .select('transfer_group')
        .limit(1);

    if (orderErr) {
        console.log('❌ orders.transfer_group does NOT exist:', orderErr.message);
        console.log('   → You need to run this in the Supabase SQL Editor:');
        console.log('   ALTER TABLE orders ADD COLUMN IF NOT EXISTS transfer_group TEXT;');
    } else {
        console.log('✅ orders.transfer_group EXISTS');
    }
}

runMigration().catch(console.error);
