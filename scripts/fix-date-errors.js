// Fix the 2 sets with date format issues (S5I and S5R)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

async function fixDateIssues() {
    console.log('🔧 Fixing date format issues for S5I and S5R...\n');

    const setsToFix = [
        {
            id: 'S5I',
            name: 'มาสเตอร์จู่โจมครั้งเดียว',
            printed_total: 70,
            total: 91,
            release_date: '2021-03-26', // Corrected date format
            logo_url: 'https://asia.pokemon-card.com/th/card-img/products/Booster_S5I_TH.png',
            series: 'Sword & Shield',
            language: 'th'
        },
        {
            id: 'S5R',
            name: 'มาสเตอร์จู่โจมต่อเนื่อง',
            printed_total: 70,
            total: 91,
            release_date: '2021-03-26', // Corrected date format
            logo_url: 'https://asia.pokemon-card.com/th/card-img/products/Booster_S5R_TH.png',
            series: 'Sword & Shield',
            language: 'th'
        }
    ];

    for (const set of setsToFix) {
        console.log(`🔄 Updating ${set.id}...`);

        const { error } = await supabase
            .from('pokemon_sets')
            .update({
                name: set.name,
                printed_total: set.printed_total,
                total: set.total,
                release_date: set.release_date,
                logo_url: set.logo_url,
                series: set.series,
                language: set.language
            })
            .eq('id', set.id);

        if (error) {
            console.error(`   ❌ Error: ${error.message}`);
        } else {
            console.log(`   ✅ Successfully updated ${set.id}`);
        }
    }

    console.log('\n✨ Fix complete!\n');
}

fixDateIssues().catch(console.error);
