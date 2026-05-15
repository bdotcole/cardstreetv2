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

const SET_ID_MAP = JSON.parse(fs.readFileSync('new-map.json', 'utf8'));

async function runLocal(dbSetId, jtcgId) {
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
    if (jtcgCards.length === 0) {
        console.log(`[${dbSetId}] Found 0 JustTCG singles.`);
        return;
    }

    const { data: dbCards } = await supabase
        .from('pokemon_cards')
        .select('id, name, number')
        .eq('set_id', dbSetId)
        .eq('language', 'en');

    if (!dbCards || dbCards.length === 0) {
        console.log(`[${dbSetId}] Found 0 DB cards.`);
        return;
    }

    const byNumber = new Map((dbCards ?? []).map(c => [String(c.number), c]));
    const byName = new Map((dbCards ?? []).map(c => [norm(c.name), c]));

    let matched = 0;
    let priced = 0;
    let rows = [];

    for (const jCard of jtcgCards) {
        const rawNum = jCard.number?.toString() ?? '';
        const strippedNum = rawNum.includes('/') ? rawNum.split('/')[0] : rawNum;
        const strippedNumNoZeros = strippedNum.replace(/^0+/, '');

        const dbCard = byNumber.get(strippedNum)
            ?? byNumber.get(strippedNumNoZeros)
            ?? byName.get(norm(jCard.name ?? ''));

        if (!dbCard) {
            continue;
        }
        matched++;

        const nmVariant = (jCard.variants ?? []).find(
            v => (v.condition === 'Near Mint' || v.condition === 'NM') && v.language === 'English'
        ) ?? (jCard.variants ?? [])[0];

        const price = nmVariant?.price ?? nmVariant?.avgPrice ?? 0;
        if (price > 0) {
            priced++;
            rows.push({
                card_id: dbCard.id,
                language: 'en',
                condition: 'Raw_NM',
                market_avg: price,
                source_links: [`https://justtcg.com/card/${jCard.id}`],
                source_prices: {
                    market_price: price,
                    low_price: nmVariant?.minPrice30d ?? 0,
                    high_price: nmVariant?.maxPrice30d ?? 0,
                    source: 'justtcg',
                },
                currency: 'USD',
                last_updated: new Date().toISOString(),
                last_priced_at: new Date().toISOString(),
            });
        }
    }

    if (rows.length > 0) {
        const dedupedRows = Array.from(new Map(rows.map(r => [r.card_id, r])).values());
        const { error: upsertErr } = await supabase
            .from('market_values')
            .upsert(dedupedRows, { onConflict: 'card_id,language,condition' });
        if (upsertErr) console.error(`[${dbSetId}] Error upsert:`, upsertErr.message);
        else console.log(`[${dbSetId}] Matched: ${matched}, Priced: ${priced}. Upserted ${dedupedRows.length} rows.`);
    } else {
        console.log(`[${dbSetId}] Matched: ${matched}, Priced: 0.`);
    }
}

async function bulkSync() {
    const { data: missingSets } = await supabase
        .rpc('get_missing_market_coverage_en');

    if (!missingSets || missingSets.length === 0) {
        console.log("No missing sets found!");
        return;
    }

    let targets = [];
    for (const s of missingSets) {
        if (SET_ID_MAP[s.set_id]) {
            targets.push(s.set_id);
        }
    }

    console.log(`Found ${targets.length} missing English sets to sync.`);
    for (let i = 0; i < targets.length; i++) {
        const setId = targets[i];
        console.log(`[${i + 1}/${targets.length}] Syncing ${setId}...`);
        try {
            await runLocal(setId, SET_ID_MAP[setId]);
        } catch (err) {
            console.error(`[${setId}] Failure:`, err.message);
        }
        await new Promise(r => setTimeout(r, 500)); // Sleep 500ms
    }
    console.log("Bulk sync completed.");
}

bulkSync();
