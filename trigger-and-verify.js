/**
 * Trigger batch-price-english for specific sets to verify the fix
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'];
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];

async function triggerSet(setId) {
    const url = `${SUPABASE_URL}/functions/v1/batch-price-english`;
    const r = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ setId }),
    });
    const j = await r.json();
    console.log(`Set ${setId}: HTTP ${r.status} –`, JSON.stringify(j));
}

async function checkPricing(setId) {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: cards } = await sb.from('pokemon_cards').select('id').eq('set_id', setId).eq('language', 'en');
    const ids = (cards || []).map(c => c.id);
    const { data: priced } = await sb.from('market_values').select('card_id').in('card_id', ids).eq('language', 'en');

    console.log(`  ${setId}: ${priced?.length || 0}/${ids.length} cards priced`);
}

async function main() {
    console.log('=== BEFORE TRIGGER ===');
    for (const id of ['sv09', 'sv10', 'sv10.5b', 'sv10.5w']) {
        await checkPricing(id);
    }

    console.log('\n=== TRIGGERING batch-price-english ===');

    // Fire off all 4 sets
    for (const setId of ['sv09', 'sv10', 'sv10.5b', 'sv10.5w']) {
        await triggerSet(setId);
        await new Promise(r => setTimeout(r, 2000)); // 2s delay between triggers
    }

    console.log('\nJobs accepted. Waiting 30s for background pricing to complete...');
    await new Promise(r => setTimeout(r, 30000));

    console.log('\n=== AFTER TRIGGER (spot check) ===');
    for (const id of ['sv09', 'sv10', 'sv10.5b', 'sv10.5w']) {
        await checkPricing(id);
    }
}

main().catch(console.error);
