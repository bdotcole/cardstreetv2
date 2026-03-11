/**
 * Revert MA3 card mappings:
 * 1. Delete all current MA3 mappings (the wrong number-based ones I just inserted)
 * 2. Re-invoke the match-thai-cards edge function for MA3 to restore proper mappings
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8')
    .split('\n')
    .forEach(l => {
        const [k, ...v] = l.split('=');
        if (k && v.length) env[k.trim()] = v.join('=').trim();
    });

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function main() {
    console.log('=== Reverting MA3 mappings ===\n');

    // Step 1: Get MA3 Thai card IDs
    const { data: thaiCards, error: thaiErr } = await sb
        .from('pokemon_cards')
        .select('id')
        .eq('set_id', 'MA3')
        .eq('language', 'th');
    if (thaiErr) throw new Error(thaiErr.message);

    const thaiIds = thaiCards.map(c => c.id);
    console.log(`Found ${thaiIds.length} MA3 Thai cards`);

    // Step 2: Delete all existing MA3 mappings (the wrong number-based ones)
    const { error: deleteErr, count } = await sb
        .from('card_mappings')
        .delete({ count: 'exact' })
        .in('card_id_th', thaiIds);
    if (deleteErr) throw new Error('Delete failed: ' + deleteErr.message);
    console.log(`Deleted ${count ?? '?'} MA3 mappings\n`);

    // Step 3: Trigger the match-thai-cards edge function for MA3 to restore proper mappings
    const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'];
    const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];

    console.log('Triggering match-thai-cards for MA3...');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/match-thai-cards`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ setId: 'MA3' }),
    });

    const result = await resp.json();
    console.log('Response status:', resp.status);
    console.log('Response:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
