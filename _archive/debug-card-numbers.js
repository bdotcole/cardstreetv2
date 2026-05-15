/**
 * Debug script: Compare card numbers in DB vs JustTCG for sv09
 * to understand why matching fails
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const KEY = env['JUSTTCG_API_KEY'];

async function main() {
    // 1. Get a sample of DB cards for sv09 (first 10)
    const { data: dbCards } = await sb.from('pokemon_cards')
        .select('id, name, number')
        .eq('set_id', 'sv09')
        .eq('language', 'en')
        .limit(10);

    console.log('=== DB cards for sv09 (first 10) ===');
    for (const c of dbCards || []) {
        console.log(`  number="${c.number}" | name="${c.name}"`);
    }

    // 2. Fetch cards from JustTCG for journey-together and compare
    const url = `https://api.justtcg.com/v1/cards?game=pokemon&set=sv09-journey-together-pokemon&conditions=NM&limit=10`;
    const r = await fetch(url, { headers: { 'x-api-key': KEY } });
    const json = await r.json();

    console.log('\n=== JustTCG cards for sv09-journey-together-pokemon (first 10) ===');
    for (const c of (json.data || []).slice(0, 10)) {
        console.log(`  number="${c.number}" | name="${c.name}" | id="${c.id}"`);
    }

    // 3. Check if any match
    if (dbCards && json.data) {
        const byNumber = new Map(dbCards.map(c => [String(c.number), c]));
        const byName = new Map(dbCards.map(c => [c.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(), c]));

        let matched = 0;
        for (const jc of json.data.slice(0, 10)) {
            const byNum = byNumber.get(jc.number?.toString());
            const normName = (jc.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
            const byNm = byName.get(normName);
            if (byNum) matched++;
            else if (byNm) matched++;
        }
        console.log(`\n=== Match result: ${matched}/10 would match ===`);
    }

    // 4. Check total available on JustTCG
    console.log(`\nJustTCG total cards for sv09: ${json.meta?.total || 'unknown'}`);
    console.log(`JustTCG hasMore: ${json.meta?.hasMore}`);
}

main().catch(console.error);
