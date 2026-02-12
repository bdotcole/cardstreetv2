// Check all Thai sets with full details
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

async function checkAllSets() {
    console.log('🔍 Checking ALL Thai Sets...\n');

    const { data, error, count } = await supabase
        .from('pokemon_sets')
        .select('*', { count: 'exact' })
        .eq('language', 'th')
        .order('id');

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    console.log(`📊 Total: ${count} Thai sets\n`);

    data.forEach(set => {
        console.log(`${set.id} | ${set.name} | ${set.release_date || 'No date'}`);
    });
}

checkAllSets().catch(console.error);
