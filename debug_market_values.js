
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkMarketValues() {
    console.log('--- Checking Market Values Table Directly ---');

    // Check if table has ANY data
    const { count, error: countError } = await supabase
        .from('market_values')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('Count Error:', countError);
    } else {
        console.log(`Total rows in market_values: ${count}`);
    }

    // Fetch a few rows
    const { data, error } = await supabase
        .from('market_values')
        .select('*')
        .limit(5);

    if (error) {
        console.error('Fetch Error:', error);
    } else {
        console.log('Sample Data:', data);
    }
}

checkMarketValues();
