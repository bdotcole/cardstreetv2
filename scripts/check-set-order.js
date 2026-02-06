const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
    }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing URL or Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSetOrder() {
    console.log('Checking set order in database...\n');

    // Check English sets
    const { data: enSets, error: enError } = await supabase
        .from('pokemon_sets')
        .select('id, name, release_date, series')
        .eq('language', 'en')
        .order('release_date', { ascending: true, nullsFirst: false });

    if (enError) {
        console.error('Error fetching English sets:', enError);
        return;
    }

    console.log('=== ENGLISH SETS (Ordered by Release Date - Oldest to Newest) ===');
    console.log(`Total: ${enSets.length} sets\n`);

    enSets.forEach((set, index) => {
        console.log(`${index + 1}. ${set.name}`);
        console.log(`   ID: ${set.id}`);
        console.log(`   Series: ${set.series || 'N/A'}`);
        console.log(`   Release Date: ${set.release_date || 'NOT SET'}`);
        console.log('');
    });

    // Check for sets without release dates
    const setsWithoutDates = enSets.filter(s => !s.release_date);
    if (setsWithoutDates.length > 0) {
        console.log('\n=== SETS WITHOUT RELEASE DATES ===');
        console.log(`Found ${setsWithoutDates.length} sets without release dates:`);
        setsWithoutDates.forEach(set => {
            console.log(`- ${set.name} (${set.id})`);
        });
    } else {
        console.log('\n✓ All English sets have release dates!');
    }

    // Check Thai sets
    console.log('\n\n=== THAI SETS (Ordered by Release Date - Oldest to Newest) ===');
    const { data: thSets, error: thError } = await supabase
        .from('pokemon_sets')
        .select('id, name, release_date, series')
        .eq('language', 'th')
        .order('release_date', { ascending: true, nullsFirst: false });

    if (thError) {
        console.error('Error fetching Thai sets:', thError);
    } else {
        console.log(`Total: ${thSets.length} sets\n`);

        thSets.forEach((set, index) => {
            console.log(`${index + 1}. ${set.name}`);
            console.log(`   Release Date: ${set.release_date || 'NOT SET'}`);
            console.log('');
        });
    }
}

checkSetOrder();
