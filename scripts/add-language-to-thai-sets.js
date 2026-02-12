// Add language column to Thai sets
// Run with: node scripts/add-language-to-thai-sets.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

// Thai set IDs
const thaiSetIds = ['MA3', 'MA2', 'MA1', 'SV11s', 'SV10s', 'SV9s', 'SV8a', 'SV8s', 'SV7s'];

async function addLanguage() {
    console.log('🔄 Adding language=th to Thai sets...\n');

    const { data, error } = await supabase
        .from('pokemon_sets')
        .update({ language: 'th' })
        .in('id', thaiSetIds)
        .select();

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    console.log(`✅ Updated ${data?.length || 0} sets with language='th'`);
    data?.forEach(set => {
        console.log(`  - ${set.id}: ${set.name}`);
    });

    console.log('\n✨ Done!\n');
}

addLanguage().catch(console.error);
