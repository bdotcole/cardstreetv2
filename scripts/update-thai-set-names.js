// Update imported Thai sets to use Thai names
// Run with: node scripts/update-thai-set-names.js

const { createClient } = require('@supabase/supabase-js');

// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of require('fs').readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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
