// Import Thai Pokemon Sets from Google Sheets data
// Run with: node scripts/import-thai-sets.js

const { createClient } = require('@supabase/supabase-js');

// Supabase connection
const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

// Thai sets data from Google Sheets
const thaiSetsData = [
    {
        setId: 'MA3',
        thaiName: 'วิวัฒนาการเมก้า ดรีมex',
        englishName: 'Mega Dream Evolution EX',
        baseCount: 193,
        secretCount: 57,
        totalCount: 250,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/11/th_news_ma3_pkg.png'
    },
    {
        setId: 'MA2',
        thaiName: 'อัคคีสีคราม',
        englishName: 'Azure Fire',
        baseCount: 103,
        secretCount: 40,
        totalCount: 143,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/09/th_product_thumbnail_MA2_pkg.png'
    },
    {
        setId: 'MA1',
        thaiName: 'วัฒนาการเมก้า',
        englishName: 'Mega Evolution',
        baseCount: 126,
        secretCount: 58,
        totalCount: 184,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/08/th_product_thumbnail_MA1_pillow.png'
    },
    {
        setId: 'SV11s',
        thaiName: 'แบล็ก & ไวท์',
        englishName: 'Black & White',
        baseCount: 172,
        secretCount: 176,
        totalCount: 348,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/06/th_product_thumbnail_SV11s_pillow.png'
    },
    {
        setId: 'SV10s',
        thaiName: 'การผงาดของผู้ไร้พ่าย',
        englishName: 'Rise of the Invincible',
        baseCount: 138,
        secretCount: 51,
        totalCount: 189,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/05/th_product_thumbnail_SV10s.png'
    },
    {
        setId: 'SV9s',
        thaiName: 'สายใยแห่งโชคชะตา',
        englishName: 'Bond of Destiny',
        baseCount: 139,
        secretCount: 46,
        totalCount: 185,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/03/th_product_thumbnail_SV9s_pillow_.png'
    },
    {
        setId: 'SV8a',
        thaiName: 'เทศกาลเทรัสตัลex',
        englishName: 'Terastal Festival ex',
        baseCount: 187,
        secretCount: 50,
        totalCount: 381,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2024/12/th_product_thumbnail_sv8a.png'
    },
    {
        setId: 'SV8s',
        thaiName: 'สเตลลาร์สายฟ้าฟาด',
        englishName: 'Supercharged Stellar',
        baseCount: 182,
        secretCount: 0,
        totalCount: 182,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2024/10/th_product_thumbnail_sv8s.png'
    },
    {
        setId: 'SV7s',
        thaiName: 'แสงนำทางแห่งสเตลลาร์',
        englishName: 'Stellar Guidance',
        baseCount: 166,
        secretCount: 57,
        totalCount: 223,
        imageUrl: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2024/07/th_product_thumbnail_SV7s.png'
    }
];

async function importThaiSets() {
    console.log('🇹🇭 Starting Thai Sets Import...\n');

    if (thaiSetsData.length === 0) {
        console.error('❌ No data found! Please paste the set data into the thaiSetsData array.');
        return;
    }

    console.log(`📊 Found ${thaiSetsData.length} sets to import\n`);

    const results = {
        success: [],
        errors: [],
        skipped: []
    };

    for (const set of thaiSetsData) {
        console.log(`\n🔄 Processing: ${set.englishName} (${set.setId})`);

        // Validate required fields
        if (!set.setId || !set.englishName) {
            console.error(`  ❌ Missing required fields`);
            results.errors.push({ set: set.setId || 'unknown', error: 'Missing setId or englishName' });
            continue;
        }

        // Check if set already exists
        const { data: existing } = await supabase
            .from('pokemon_sets')
            .select('id')
            .eq('id', set.setId)
            .single();

        if (existing) {
            console.log(`  ⏭️  Set already exists, skipping`);
            results.skipped.push(set.setId);
            continue;
        }

        // Prepare set data for insertion
        const setData = {
            id: set.setId,
            name: set.thaiName, // Use Thai name as primary name
            series: 'Scarlet & Violet', // Default - can be updated
            printed_total: set.baseCount || null,
            total: set.totalCount || null,
            release_date: null, // Can be added later
            logo_url: set.imageUrl || null
        };

        // Insert set
        const { data, error } = await supabase
            .from('pokemon_sets')
            .insert([setData])
            .select();

        if (error) {
            console.error(`  ❌ Error:`, error.message);
            results.errors.push({ set: set.setId, error: error.message });
        } else {
            console.log(`  ✅ Imported successfully`);
            console.log(`     Thai: ${set.thaiName}`);
            console.log(`     English: ${set.englishName}`);
            console.log(`     Cards: ${set.totalCount} (${set.baseCount} base + ${set.secretCount} secret)`);
            results.success.push(set.setId);
        }
    }

    // Print summary
    console.log('\n\n📊 Import Summary:');
    console.log('=====================================');
    console.log(`✅ Successfully imported: ${results.success.length}`);
    console.log(`⏭️  Skipped (already exists): ${results.skipped.length}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    if (results.success.length > 0) {
        console.log('\n✅ Imported sets:', results.success.join(', '));
    }

    if (results.errors.length > 0) {
        console.log('\n❌ Errors:');
        results.errors.forEach(e => console.log(`   ${e.set}: ${e.error}`));
    }

    if (results.skipped.length > 0) {
        console.log('\n⏭️  Skipped:', results.skipped.join(', '));
    }

    console.log('\n✨ Import complete!\n');
}

// Run the import
importThaiSets().catch(console.error);
