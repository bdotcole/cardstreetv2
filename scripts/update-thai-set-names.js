// Update imported Thai sets to use Thai names
// Run with: node scripts/update-thai-set-names.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

// Map of set IDs to Thai names
const thaiNames = {
    'MA3': 'วิวัฒนาการเมก้า ดรีมex',
    'MA2': 'อัคคีสีคราม',
    'MA1': 'วัฒนาการเมก้า',
    'SV11s': 'แบล็ก & ไวท์',
    'SV10s': 'การผงาดของผู้ไร้พ่าย',
    'SV9s': 'สายใยแห่งโชคชะตา',
    'SV8a': 'เทศกาลเทรัสตัลex',
    'SV8s': 'สเตลลาร์สายฟ้าฟาด',
    'SV7s': 'แสงนำทางแห่งสเตลลาร์'
};

async function updateSetNames() {
    console.log('🔄 Updating Thai set names...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const [setId, thaiName] of Object.entries(thaiNames)) {
        console.log(`Updating ${setId} → ${thaiName}`);

        const { data, error } = await supabase
            .from('pokemon_sets')
            .update({ name: thaiName })
            .eq('id', setId)
            .select();

        if (error) {
            console.error(`  ❌ Error: ${error.message}`);
            errorCount++;
        } else if (data && data.length > 0) {
            console.log(`  ✅ Updated`);
            successCount++;
        } else {
            console.log(`  ⚠️  Set not found`);
        }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Updated: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('\n✨ Done!\n');
}

updateSetNames().catch(console.error);
