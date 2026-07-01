// Quick verification script to check Thai sets in database
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
