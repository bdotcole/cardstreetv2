const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const roleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const apiKeyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = roleMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const JUSTTCG_API_KEY = apiKeyMatch[1].trim();
const JUSTTCG_BASE = 'https://api.justtcg.com/v1';

async function jtcgFetch(path) {
    const r = await fetch(`${JUSTTCG_BASE}${path}`, {
        headers: { 'x-api-key': JUSTTCG_API_KEY, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`JustTCG ${r.status}: ${await r.text()}`);
    return r.json();
}

function norm(s) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function testSet(dbSetId, jtcgId) {
    let allJtcgCards = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const resp = await jtcgFetch(
            `/cards?game=pokemon&set=${encodeURIComponent(jtcgId)}&conditions=NM&include_price_history=false&limit=${limit}&offset=${offset}`
        );
        const page = resp.data ?? [];
        allJtcgCards = allJtcgCards.concat(page);
        if (!resp.meta?.hasMore || page.length < limit) break;
        offset += limit;
    }

    const jtcgCards = allJtcgCards.filter(c => c.number && c.number !== 'N/A');
    console.log(`Found ${jtcgCards.length} JustTCG singles for ${dbSetId}`);

    const { data: dbCards } = await supabase
        .from('pokemon_cards')
        .select('id, name, number, rarity')
        .eq('set_id', dbSetId)
        .eq('language', 'en');

    console.log(`Found ${dbCards?.length || 0} DB cards for ${dbSetId}`);

    // Show some samples of DB vs JustTCG to spot mismatched structures
    console.log("\n--- DB Card Samples ---");
    dbCards.slice(0, 3).forEach(c => console.log(`${c.name} (#${c.number} ${c.rarity})`));
    console.log("\n--- JustTCG Card Samples ---");
    jtcgCards.slice(0, 3).forEach(c => console.log(`${c.name} (#${c.number} ${c.rarity})`));

    const byNumber = new Map((dbCards ?? []).map(c => [String(c.number), c]));
    const byName = new Map((dbCards ?? []).map(c => [norm(c.name), c]));

    let matched = 0;
    let priced = 0;
    let mismatchLog = 0;
    let wrongPriceLog = 0;

    for (const jCard of jtcgCards) {
        const rawNum = jCard.number?.toString() ?? '';
        const strippedNum = rawNum.includes('/') ? rawNum.split('/')[0] : rawNum;
        const strippedNumNoZeros = strippedNum.replace(/^0+/, '');

        const dbCard = byNumber.get(strippedNum)
            ?? byNumber.get(strippedNumNoZeros)
            ?? byName.get(norm(jCard.name ?? ''));

        if (!dbCard) {
            if (mismatchLog < 10) {
                console.log(`[MISMATCH] JustTCG: "${jCard.name}" (#${jCard.number}) -> No DB match found.`);
                mismatchLog++;
            }
            continue;
        }
        matched++;

        // User mentioned "wrong prices" - this logic might pick reverse holos over normals!
        const normalVariant = (jCard.variants ?? []).find(
            v => (v.condition === 'Near Mint' || v.condition === 'NM') && v.language === 'English' && v.printing === 'Normal'
        );
        const nmVariant = normalVariant ?? (jCard.variants ?? []).find(
            v => (v.condition === 'Near Mint' || v.condition === 'NM') && v.language === 'English'
        ) ?? (jCard.variants ?? [])[0];

        const price = nmVariant?.price ?? nmVariant?.avgPrice ?? 0;
        if (price > 0) {
            priced++;
            if (wrongPriceLog < 10) {
                console.log(`[PRICED] "${dbCard.name}" (#${dbCard.number}) matched JustTCG (#${jCard.number}) -> $${price} (${nmVariant.printing})`);
                wrongPriceLog++;
            }
        } else {
            if (mismatchLog < 10) {
                console.log(`[ZERO_PRICE] "${dbCard.name}" (#${dbCard.number}) matched ${jCard.name} but has no valid price. Variants:`, jCard.variants.length);
                mismatchLog++;
            }
        }
    }

    console.log(`\nMatched: ${matched}, Priced: ${priced}`);
}

async function run() {
    await testSet('sv10', 'sv10-destined-rivals-pokemon');
    console.log("\n==================================\n");
    await testSet('sv09', 'sv09-journey-together-pokemon');
}
run();
