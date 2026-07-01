
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

async function verify() {
    console.log('🔍 Verifying MA3 set in database...');

    // Check set
    const { data: set, error: setError } = await supabase
        .from('pokemon_sets')
        .select('*')
        .eq('id', 'MA3')
        .single();

    if (setError) {
        console.error('❌ Set MA3 not found or error:', setError.message);
    } else {
        console.log(`✅ Found Set: ${set.name} (${set.id})`);
        console.log(`   Printed Total: ${set.printed_total}`);
        console.log(`   Total: ${set.total}`);
    }

    // Check cards count
    const { count, error: countError } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('set_id', 'MA3');

    if (countError) {
        console.error('❌ Error counting cards:', countError.message);
    } else {
        console.log(`✅ Cards in DB: ${count}`);
    }
}

verify();
