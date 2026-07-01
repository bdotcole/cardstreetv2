// Fix the 2 sets with date format issues (S5I and S5R)
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
