// Add language column to Thai sets
// Run with: node scripts/add-language-to-thai-sets.js

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
