/**
 * Wait and check Black Bolt and White Flare pricing
 * Also check how many JustTCG had prices vs our DB count
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const KEY = env['JUSTTCG_API_KEY'];

async function checkPricingFull(setId) {
    const { data: cards } = await sb.from('pokemon_cards').select('id, name').eq('set_id', setId).eq('language', 'en');
    const ids = (cards || []).map(c => c.id);
    const { data: priced } = await sb.from('market_values').select('card_id, market_avg').in('card_id', ids).eq('language', 'en');

    const pricedSet = new Set((priced || []).map(p => p.card_id));
    const unpriced = (cards || []).filter(c => !pricedSet.has(c.id));

    console.log(`  ${setId}: ${priced?.length || 0}/${ids.length} priced`);
    if (unpriced.length > 0 && unpriced.length <= 20) {
        console.log(`    Unpriced: ${unpriced.map(c => c.name).join(', ')}`);
    } else if (unpriced.length > 0) {
        console.log(`    (${unpriced.length} unpriced cards)`);
    }
}

async function checkJustTCGCount(jtcgId) {
    const url = `https://api.justtcg.com/v1/cards?game=pokemon&set=${encodeURIComponent(jtcgId)}&conditions=NM&include_price_history=false&limit=1`;
    const r = await fetch(url, { headers: { 'x-api-key': KEY } });
    const j = await r.json();
    return j.meta?.total || 0;
}

async function main() {
    console.log('\n=== FULL PRICING STATUS (waiting 60s first) ===');
    await new Promise(r => setTimeout(r, 60000));

    for (const [setId, jtcgId] of [
        ['sv09', 'sv09-journey-together-pokemon'],
        ['sv10', 'sv10-destined-rivals-pokemon'],
        ['sv10.5b', 'sv-black-bolt-pokemon'],
        ['sv10.5w', 'sv-white-flare-pokemon'],
    ]) {
        await checkPricingFull(setId);
    }
}

main().catch(console.error);
