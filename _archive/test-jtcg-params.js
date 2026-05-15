/**
 * Test JustTCG API with different params to find the right way to get individual cards
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const KEY = env['JUSTTCG_API_KEY'];

async function jtcgFetch(endpoint) {
    const r = await fetch(`https://api.justtcg.com/v1${endpoint}`, { headers: { 'x-api-key': KEY } });
    return r.json();
}

async function main() {
    // Try type=single filter
    console.log('\n=== Testing /cards with type=single ===');
    const r1 = await jtcgFetch('/cards?game=pokemon&set=sv09-journey-together-pokemon&conditions=NM&type=single');
    const first5 = (r1.data || []).slice(0, 5);
    console.log('Total:', r1.meta?.total, 'hasMore:', r1.meta?.hasMore);
    for (const c of first5) console.log(`  number="${c.number}" | name="${c.name}"`);

    // Try without conditions
    console.log('\n=== Testing /cards without conditions, type=single ===');
    const r2 = await jtcgFetch('/cards?game=pokemon&set=sv09-journey-together-pokemon&type=single');
    const first5b = (r2.data || []).slice(0, 5);
    console.log('Total:', r2.meta?.total, 'hasMore:', r2.meta?.hasMore);
    for (const c of first5b) console.log(`  number="${c.number}" | name="${c.name}"`);

    // Try with offset to skip sealed
    console.log('\n=== Testing page 2 (offset=20) ===');
    const r3 = await jtcgFetch('/cards?game=pokemon&set=sv09-journey-together-pokemon&conditions=NM&offset=20');
    const first5c = (r3.data || []).slice(0, 5);
    console.log('Total:', r3.meta?.total);
    for (const c of first5c) console.log(`  number="${c.number}" | name="${c.name}"`);

    // Try smaller alternative - cards endpoint
    console.log('\n=== Black Bolt test with type=single ===');
    const r4 = await jtcgFetch('/cards?game=pokemon&set=sv-black-bolt-pokemon&conditions=NM&type=single');
    const first5d = (r4.data || []).slice(0, 5);
    console.log('Total:', r4.meta?.total, 'hasMore:', r4.meta?.hasMore);
    for (const c of first5d) console.log(`  number="${c.number}" | name="${c.name}"`);
}

main().catch(console.error);
