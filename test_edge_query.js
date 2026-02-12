
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testQuery() {
    console.log('Testing Edge Function Query Logic...');

    // Test with specific known card
    const cardName = 'Caterpie';
    const targetSetIds = ['sv09'];

    console.log(`Searching for "${cardName}" in sets [${targetSetIds.join(', ')}]...`);

    // 1. Original Query structure from index.ts
    const { data: results, error } = await supabase
        .from('pokemon_cards')
        .select('*, pokemon_sets!inner(release_date)')
        .eq('language', 'en')
        .in('set_id', targetSetIds)
        .ilike('name', cardName);

    if (error) {
        console.error('Query Failed:', error);
    } else {
        console.log(`Query returned ${results.length} rows.`);
        if (results.length > 0) {
            console.log('Sample Row:', JSON.stringify(results[0], null, 2));
        }
    }

    // 2. Test without inner join
    console.log('\nTesting WITHOUT inner join...');
    const { data: results2, error: error2 } = await supabase
        .from('pokemon_cards')
        .select('*, pokemon_sets(release_date)') // Standard left join
        .eq('language', 'en')
        .in('set_id', targetSetIds)
        .ilike('name', cardName);

    if (error2) {
        console.error('Query 2 Failed:', error2);
    } else {
        console.log(`Query 2 returned ${results2.length} rows.`);
        if (results2.length > 0) {
            console.log('Sample Row 2:', JSON.stringify(results2[0], null, 2));
        }
    }
}

testQuery();
