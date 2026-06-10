const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env vars
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key] = value.trim();
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    const sql = `
-- Rename legacy column to Flash Express if it hasn't been already
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipping_labels' AND column_name='shippop_purchase_id') THEN
        ALTER TABLE shipping_labels RENAME COLUMN shippop_purchase_id TO flash_order_id;
    END IF; 
END $$;

ALTER TABLE shipping_labels 
  ADD COLUMN IF NOT EXISTS pickup_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pickup_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS flash_sort_code TEXT DEFAULT NULL;

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS sub_district TEXT DEFAULT NULL;

COMMENT ON TABLE shipping_labels IS 'Flash Express shipping integration - stores tracking, labels, and pickup data';
`;
    // We don't have a direct raw SQL execution from the JS client without RPC.
    // Instead we will rely on checking if the columns exist, but since we can't execute raw SQL via JS,
    // let's create a quick Postgres script using psql if available, or just instruct the user.
    console.log("Please run the 20260502_flash_express_migration.sql against your Supabase database via the SQL Editor.");
}

runMigration();
