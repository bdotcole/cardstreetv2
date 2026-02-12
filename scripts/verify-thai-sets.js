// Quick verification script to check Thai sets in database
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

async function verifyThaiSets() {
    console.log('🔍 Verifying Thai Sets in Database...\n');

    const { data, error, count } = await supabase
        .from('pokemon_sets')
        .select('id, name, series, total, release_date', { count: 'exact' })
        .eq('language', 'th')
        .order('release_date', { ascending: false, nullsFirst: false });

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    console.log(`📊 Total Thai sets in database: ${count}\n`);
    console.log('Recent sets:');
    console.log('='.repeat(80));

    data.slice(0, 10).forEach(set => {
        console.log(`${set.id.padEnd(8)} | ${set.name.padEnd(35)} | ${set.series.padEnd(20)} | ${set.total || 'N/A'} cards | ${set.release_date || 'No date'}`);
    });

    console.log('\n✅ Verification complete!\n');
}

verifyThaiSets().catch(console.error);
