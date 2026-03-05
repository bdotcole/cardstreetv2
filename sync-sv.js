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

        // Score variants to handle troll listings (e.g. $5000 fake 'Normal' NM with 0 sales)
        const enVariants = (jCard.variants ?? []).filter(v => v.language === 'English' || !v.language);

        const sortedVariants = enVariants.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            // Massive priority to variants with confirmed market adoption (avgPrice > 0)
            if (a.avgPrice > 0) scoreA += 1000;
            if (b.avgPrice > 0) scoreB += 1000;

            // Condition priority
            if (a.condition === 'Near Mint' || a.condition === 'NM') scoreA += 500;
            else if (a.condition === 'Lightly Played' || a.condition === 'LP') scoreA += 200;

            if (b.condition === 'Near Mint' || b.condition === 'NM') scoreB += 500;
            else if (b.condition === 'Lightly Played' || b.condition === 'LP') scoreB += 200;

            // Printing priority (Holos are usually the legitimate chase listing)
            if (a.printing === 'Holofoil') scoreA += 100;
            else if (a.printing === 'Reverse Holofoil') scoreA += 50;

            if (b.printing === 'Holofoil') scoreB += 100;
            else if (b.printing === 'Reverse Holofoil') scoreB += 50;

            // Tie-breaker: prioritize lower price if both have 0 sales, to avoid $5000 troll outliers
            if (scoreA === scoreB && a.avgPrice === 0 && b.avgPrice === 0) {
                return (a.price || 99999) - (b.price || 99999);
            }

            return scoreB - scoreA;
        });

        const bestVariant = sortedVariants[0] ?? (jCard.variants ?? [])[0];
        const price = bestVariant?.avgPrice || bestVariant?.price || 0;
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
                    low_price: bestVariant?.minPrice30d ?? 0,
                    high_price: bestVariant?.maxPrice30d ?? 0,
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
    const sets = [
        { db: 'gym2', jtcg: 'gym-challenge-pokemon' },
        { db: 'gym1', jtcg: 'gym-heroes-pokemon' },
        { db: 'ecard3', jtcg: 'skyridge-pokemon' },
        { db: 'si1', jtcg: 'southern-islands-pokemon' },
        { db: 'lc', jtcg: 'legendary-collection-pokemon' },
        { db: 'ecard1', jtcg: 'expedition-base-set-pokemon' },
        { db: 'ecard2', jtcg: 'aquapolis-pokemon' },
    ];

    console.log(`Syncing ${sets.length} vintage sets...`);
    for (const s of sets) {
        console.log(`\n--- Starting ${s.db} (${s.jtcg}) ---`);
        await runLocal(s.db, s.jtcg);
        // Extra 3s pause between sets to be safe
        await new Promise(r => setTimeout(r, 3000));
    }
    console.log('\nAll vintage sets synced.');
}

bulkSync();
