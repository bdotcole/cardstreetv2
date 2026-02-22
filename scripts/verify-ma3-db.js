
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

async function verify() {
    console.log('🔍 Verifying MA3 set in database...');

    // Check set
    const { data: set, error: setError } = await supabase
        .from('pokemon_sets')
        .select('*')
        .eq('id', 'MA3')
        .single();

    if (setError) {
        console.error('❌ Set MA3 not found or error:', setError.message);
    } else {
        console.log(`✅ Found Set: ${set.name} (${set.id})`);
        console.log(`   Printed Total: ${set.printed_total}`);
        console.log(`   Total: ${set.total}`);
    }

    // Check cards count
    const { count, error: countError } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('set_id', 'MA3');

    if (countError) {
        console.error('❌ Error counting cards:', countError.message);
    } else {
        console.log(`✅ Cards in DB: ${count}`);
    }
}

verify();
