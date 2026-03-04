/**
 * Check market pricing status for the 4 key sets after background jobs ran
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function checkPricing(setId) {
    const { data: cards } = await sb.from('pokemon_cards').select('id, name').eq('set_id', setId).eq('language', 'en');
    const ids = (cards || []).map(c => c.id);
    if (ids.length === 0) { console.log(`  ${setId}: No cards found!`); return; }

    const { data: priced } = await sb.from('market_values').select('card_id, market_avg, last_updated').in('card_id', ids).eq('language', 'en');

    const pricedCount = priced?.length || 0;
    console.log(`  ${setId}: ${pricedCount}/${ids.length} cards priced`);
    if (pricedCount > 0) {
        const sample = priced.slice(0, 3);
        for (const p of sample) {
            const card = cards.find(c => c.id === p.card_id);
            console.log(`    - ${card?.name}: $${p.market_avg} (updated ${p.last_updated})`);
        }
    }
}

async function main() {
    console.log('=== PRICING STATUS CHECK ===');
    for (const id of ['sv09', 'sv10', 'sv10.5b', 'sv10.5w']) {
        await checkPricing(id);
    }
}

main().catch(console.error);
