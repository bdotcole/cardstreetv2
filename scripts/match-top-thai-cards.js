/**
 * match-top-thai-cards.js
 *
 * Name-first + rarity-based matching for high-rarity Thai cards.
 * Target: Top 20 cards per Thai set (by rarity tier) matched with >=90% name similarity.
 * 
 * Strategy: For each high-rarity Thai card, match to English card by:
 *   1. english_name similarity >= 0.90 (primary filter)
 *   2. English rarity matches the mapped rarity (secondary filter)
 * 
 * This is INDEPENDENT of card number — works for Thai sets like MA3 where
 * numbers don't align with English equivalents.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── Rarity Map (from Rarity Table - Sheet1.csv) ──────────────────────────────
// Thai/JP → English rarity name(s)
const RARITY_MAP = {
    'C':   ['Common'],
    'U':   ['Uncommon'],
    'R':   ['Rare'],
    'RR':  ['Double Rare'],
    'SR':  ['Ultra Rare'],     // Super Rare (Thai) = Ultra Rare (EN)
    'AR':  ['Illustration Rare'],
    'SAR': ['Special Illustration Rare'],
    'UR':  ['Hyper Rare'],     // Ultra Rare (Thai) = Hyper Rare (EN)
    'MUR': ['Mega Hyper Rare', 'Hyper Rare'], // Mega Ultra Rare = Mega Hyper Rare in me02.5
    'MA':  ['Ultra Rare'],     // Master Art (Thai) = Ultra Rare (EN)
    'PB':  null,               // Pokeball reverse holo — no EN rarity filter
    'EH':  null,               // Energy reverse holo — no EN rarity filter
    // Pass-through if Thai already uses English rarity names
    'Common': ['Common'], 'Uncommon': ['Uncommon'], 'Rare': ['Rare'],
    'Double Rare': ['Double Rare'], 'Ultra Rare': ['Ultra Rare'],
    'Illustration Rare': ['Illustration Rare'],
    'Special Illustration Rare': ['Special Illustration Rare'],
    'Hyper Rare': ['Hyper Rare'],
};

// Rarity tiers (highest = most important to match; we target top 20 per set by tier)
const RARITY_TIER = {
    'MUR': 0, 'UR': 1, 'SAR': 2, 'AR': 3, 'MA': 4,
    'SR': 5, 'RR': 6, 'Hyper Rare': 0, 'Special Illustration Rare': 2,
    'Illustration Rare': 3, 'Ultra Rare': 5, 'Double Rare': 6,
    'R': 7, 'Rare': 7, 'U': 8, 'Uncommon': 8, 'C': 9, 'Common': 9,
    'PB': 6, 'EH': 6,
};

// ── Levenshtein similarity ────────────────────────────────────────────────────
function similarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
    if (a === b) return 1.0;
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, (_, i) =>
        Array.from({length: n+1}, (_, j) => i===0 ? j : j===0 ? i : 0)
    );
    for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
        dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j-1],dp[i][j-1],dp[i-1][j]);
    return (Math.max(m,n) - dp[m][n]) / Math.max(m,n);
}

// ── Paginate helper ───────────────────────────────────────────────────────────
async function fetchAll(queryFn) {
    let all = [], page = 0, PAGE = 1000;
    while (true) {
        const { data, error } = await queryFn(page * PAGE, (page+1) * PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        page++;
    }
    return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const MIN_SIMILARITY = 0.82; // minimum name similarity to accept a match

    console.log('Loading all English cards...');
    const allEnCards = await fetchAll((from, to) =>
        supabase.from('pokemon_cards')
            .select('id, name, rarity, set_id, number')
            .eq('language', 'en')
            .range(from, to)
    );
    console.log(`${allEnCards.length} English cards loaded.`);

    // Build indices for fast lookup
    const enByName = {};         // lower(name) → [card, ...]
    const enBySet  = {};         // set_id → [card, ...]
    for (const c of allEnCards) {
        const key = c.name.toLowerCase().trim();
        if (!enByName[key]) enByName[key] = [];
        enByName[key].push(c);
        if (!enBySet[c.set_id]) enBySet[c.set_id] = [];
        enBySet[c.set_id].push(c);
    }

    // Load set_bridge so we know which EN sets each Thai set corresponds to
    const { data: bridgeRows } = await supabase.from('set_bridge').select('thai_set_id, english_set_id');
    const thaiToEnSets = {};
    for (const row of bridgeRows || []) {
        if (!row.english_set_id) continue;
        if (!thaiToEnSets[row.thai_set_id]) thaiToEnSets[row.thai_set_id] = [];
        thaiToEnSets[row.thai_set_id].push(row.english_set_id);
    }

    console.log('Loading all Thai sets...');
    const { data: thaiSets } = await supabase
        .from('pokemon_sets').select('id, name').eq('language', 'th');

    const results = { matched: 0, skipped: 0 };
    const toUpsert = [];

    for (const set of thaiSets) {
        // Load ALL Thai cards with english_name for this set
        const { data: thaiCards } = await supabase
            .from('pokemon_cards')
            .select('id, name, english_name, rarity, number, set_id')
            .eq('set_id', set.id)
            .eq('language', 'th')
            .not('english_name', 'is', null);

        if (!thaiCards?.length) continue;

        const bridgedEnSetIds = thaiToEnSets[set.id] || [];

        for (const thaiCard of thaiCards) {
            const enRarities = RARITY_MAP[thaiCard.rarity]; // undefined = unknown, null = no filter
            const searchName = thaiCard.english_name.toLowerCase().trim();

            // ── Step 1: Exact name hit ────────────────────────────────────────
            let exactHits = enByName[searchName] || [];

            // ── Step 2: Build candidate pool ─────────────────────────────────
            // Prefer bridged sets → then all EN cards for fuzzy pass
            let candidates;
            if (exactHits.length > 0) {
                candidates = exactHits; // Exact match found — narrow pool
            } else {
                // First try bridged sets (smaller, faster)
                const bridgedCandidates = bridgedEnSetIds.flatMap(sid => enBySet[sid] || []);
                candidates = bridgedCandidates.length > 0 ? bridgedCandidates : allEnCards;
            }

            // ── Step 3: Score candidates ──────────────────────────────────────
            let best = null, bestScore = 0;
            for (const enCard of candidates) {
                const nameSim = similarity(searchName, enCard.name);
                if (nameSim < MIN_SIMILARITY) continue;

                // Rarity bonus: undefined = no filter, null = no filter
                const rarityMatch = !enRarities ||
                    enRarities.some(r => r.toLowerCase() === (enCard.rarity || '').toLowerCase());
                const score = rarityMatch ? nameSim + 0.1 : nameSim;

                if (score > bestScore) { best = enCard; bestScore = score; }
            }

            // ── Step 4: If still no match from bridged, try all EN cards ─────
            if (!best && bridgedEnSetIds.length > 0 && exactHits.length === 0) {
                for (const enCard of allEnCards) {
                    const nameSim = similarity(searchName, enCard.name);
                    if (nameSim < MIN_SIMILARITY) continue;
                    const rarityMatch = !enRarities ||
                        enRarities.some(r => r.toLowerCase() === (enCard.rarity || '').toLowerCase());
                    const score = rarityMatch ? nameSim + 0.1 : nameSim;
                    if (score > bestScore) { best = enCard; bestScore = score; }
                }
            }

            // ── Step 5: Prefix augmentation — try "Mega/Galarian/Alolan/Hisuian " + name ──
            // Handles MA3 case: Thai english_name="Gengar ex" but EN card="Mega Gengar ex"
            if (!best || bestScore < MIN_SIMILARITY + 0.1) {
                const prefixes = ['Mega ', 'Galarian ', 'Alolan ', 'Hisuian '];
                const searchPool = bridgedEnSetIds.length > 0
                    ? bridgedEnSetIds.flatMap(sid => enBySet[sid] || [])
                    : allEnCards;

                // Also try stripping any prefix from the thai name
                const strippedName = searchName.replace(/^(mega|galarian|alolan|hisuian)\s+/i, '');

                for (const prefix of prefixes) {
                    const augmented = prefix.toLowerCase() + (strippedName || searchName);
                    for (const enCard of searchPool) {
                        const nameSim = similarity(augmented, enCard.name);
                        if (nameSim < 0.90) continue; // require high confidence for prefix matches
                        const rarityMatch = !enRarities ||
                            enRarities.some(r => r.toLowerCase() === (enCard.rarity || '').toLowerCase());
                        const score = rarityMatch ? nameSim + 0.1 : nameSim;
                        if (score > bestScore) { best = enCard; bestScore = score; }
                    }
                    if (best && bestScore >= 0.90) break;
                }
            }

            if (best) {
                const rawConf = Math.min(1.0, bestScore - 0.1); // remove the 0.1 rarity bonus
                const confidence = parseFloat(Math.min(1.0, rawConf).toFixed(2));
                toUpsert.push({
                    card_id_th: thaiCard.id,
                    card_id_en: best.id,
                    match_method: 'name_rarity',
                    confidence_score: confidence,
                    verified: confidence >= 0.95,
                });
                results.matched++;
            } else {
                results.skipped++;
            }
        }

        process.stdout.write(`\r  ${set.id}: ${thaiCards.length} cards | total matched ${results.matched}, skipped ${results.skipped}   `);
    }

    console.log(`\n\nMatched: ${results.matched}, Skipped: ${results.skipped}`);
    console.log(`Upserting ${toUpsert.length} mappings...`);

    const CHUNK = 500;
    for (let i = 0; i < toUpsert.length; i += CHUNK) {
        const chunk = toUpsert.slice(i, i + CHUNK);
        const { error } = await supabase
            .from('card_mappings')
            .upsert(chunk, { onConflict: 'card_id_th' });
        if (error) console.error('Upsert error:', error);
        else process.stdout.write(`\r  Upserted ${Math.min(i + CHUNK, toUpsert.length)}/${toUpsert.length}   `);
    }

    console.log('\n\n✅ Full Thai card matching complete!');
    console.log('Run: node scripts/batch-thai-pricing.js');
}

main().catch(console.error);


