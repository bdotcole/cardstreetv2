/**
 * complete-thai-matching.js
 * Finishes matching remaining Thai cards to English cards via set_bridge.
 * Same logic as the match-thai-cards Edge Function but runs locally with no CPU limit.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Rarity mapping (mirrors Edge Function logic + extended for Thai-specific codes)
const RARITY_MAP = {
    'C': ['Common'], 'U': ['Uncommon'], 'R': ['Rare'],
    'RR': ['Double Rare'], 'SR': ['Ultra Rare'],
    'AR': ['Illustration Rare'], 'SAR': ['Special Illustration Rare'],
    'UR': ['Hyper Rare'],
    // Thai-specific gold card codes
    'MUR': ['Hyper Rare'],          // Thai Hyper Rare (gold card)
    'MA': ['Ultra Rare'],            // Thai Master Art -> English Ultra Rare
    'PR': ['Promo'],                 // Promo
    // Pass-through English rarity names
    'Common': ['Common'], 'Uncommon': ['Uncommon'], 'Rare': ['Rare'],
    'Double Rare': ['Double Rare'], 'Ultra Rare': ['Ultra Rare'],
    'Illustration Rare': ['Illustration Rare'],
    'Special Illustration Rare': ['Special Illustration Rare'],
    'Hyper Rare': ['Hyper Rare'],
};
const NO_RARITY_SET = new Set(['PB', 'EH']);

function mapRarity(r) {
    if (!r || NO_RARITY_SET.has(r)) return null;
    return RARITY_MAP[r] ?? [r];
}

function normaliseNumber(n) {
    if (!n) return '';
    return n.replace(/^0+(\d)/, '$1').trim().toLowerCase();
}

function similarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
    );
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j-1], dp[i][j-1], dp[i-1][j]);
    const longer = Math.max(m, n);
    return longer === 0 ? 1 : (longer - dp[m][n]) / longer;
}

async function paginate(query) {
    let all = [], page = 0, PAGE = 1000;
    while (true) {
        const { data, error } = await query(page * PAGE, (page + 1) * PAGE - 1);
        if (error || !data?.length) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        page++;
    }
    return all;
}

async function main() {
    console.log('Loading set_bridge...');
    const { data: bridgeRows } = await supabase.from('set_bridge').select('thai_set_id, english_set_id');
    const thaiToEnSets = {};
    for (const row of bridgeRows || []) {
        if (!row.english_set_id) continue;
        if (!thaiToEnSets[row.thai_set_id]) thaiToEnSets[row.thai_set_id] = [];
        thaiToEnSets[row.thai_set_id].push(row.english_set_id);
    }
    const thaiSetIds = Object.keys(thaiToEnSets);
    console.log(`${thaiSetIds.length} Thai sets in bridge.`);

    console.log('Loading already-mapped Thai card IDs...');
    const { data: existingMappings } = await supabase.from('card_mappings').select('card_id_th');
    const alreadyMapped = new Set((existingMappings || []).map(m => m.card_id_th));
    console.log(`${alreadyMapped.size} already mapped.`);

    console.log('Loading unmatched Thai cards...');
    const allThaiCards = await paginate((from, to) =>
        supabase.from('pokemon_cards')
            .select('id, name, english_name, number, rarity, set_id')
            .eq('language', 'th')
            .in('set_id', thaiSetIds)
            .range(from, to)
    );
    const unmapped = allThaiCards.filter(c => !alreadyMapped.has(c.id));
    console.log(`${unmapped.length} unmatched Thai cards to process.`);

    if (unmapped.length === 0) {
        console.log('Nothing to do!');
        return;
    }

    const allEnSetIds = [...new Set(Object.values(thaiToEnSets).flat())];
    console.log('Loading English candidate pool...');
    const allEnCards = await paginate((from, to) =>
        supabase.from('pokemon_cards')
            .select('id, name, number, rarity, set_id')
            .eq('language', 'en')
            .in('set_id', allEnSetIds)
            .range(from, to)
    );
    console.log(`${allEnCards.length} English candidate cards loaded.`);

    // Index EN cards by set_id
    const enBySet = {};
    for (const c of allEnCards) {
        if (!enBySet[c.set_id]) enBySet[c.set_id] = [];
        enBySet[c.set_id].push(c);
    }

    // Match loop
    const toInsert = [];
    let matched = 0, skipped = 0;

    for (const thaiCard of unmapped) {
        const enSetIds = thaiToEnSets[thaiCard.set_id];
        if (!enSetIds?.length) { skipped++; continue; }

        const thaiNum = normaliseNumber(thaiCard.number);
        const englishRarities = mapRarity(thaiCard.rarity);
        const isNoRarity = englishRarities === null;

        let bestMatch = null, bestConf = 0, matchMethod = '';

        for (const enSetId of enSetIds) {
            const candidates = enBySet[enSetId] ?? [];

            // (A) Number + rarity
            if (!isNoRarity && englishRarities) {
                const byNumRarity = candidates.filter(c =>
                    normaliseNumber(c.number) === thaiNum &&
                    englishRarities.some(r => r && c.rarity && r.toLowerCase() === c.rarity.toLowerCase())
                );
                if (byNumRarity.length === 1) {
                    bestMatch = byNumRarity[0]; bestConf = 1.0; matchMethod = 'number_rarity'; break;
                }
                if (byNumRarity.length > 1) {
                    const sName = (thaiCard.english_name ?? thaiCard.name ?? '').toLowerCase();
                    for (const c of byNumRarity) {
                        const sim = similarity(sName, c.name);
                        if (sim > bestConf) { bestConf = sim; bestMatch = c; matchMethod = 'number_rarity_name'; }
                    }
                    if (bestConf >= 0.85) break;
                }
            }

            // (B) Number-only
            const byNum = candidates.filter(c => normaliseNumber(c.number) === thaiNum);
            if (byNum.length === 1 && bestConf < 0.9) {
                bestMatch = byNum[0]; bestConf = isNoRarity ? 0.9 : 0.75; matchMethod = 'number_only';
            } else if (byNum.length > 1) {
                const sName = (thaiCard.english_name ?? thaiCard.name ?? '').toLowerCase();
                for (const c of byNum) {
                    const sim = similarity(sName, c.name);
                    if (sim > bestConf) { bestConf = sim; bestMatch = c; matchMethod = 'number_name_fuzzy'; }
                }
            }

            // (C) Name similarity fallback
            if (!bestMatch && thaiCard.english_name) {
                const sName = thaiCard.english_name.toLowerCase();
                for (const c of candidates) {
                    const sim = similarity(sName, c.name);
                    if (sim >= 0.85 && sim > bestConf) { bestConf = sim; bestMatch = c; matchMethod = 'name_fuzzy'; }
                }
            }
        }

        if (bestMatch && bestConf >= 0.75) {
            toInsert.push({
                card_id_th: thaiCard.id,
                card_id_en: bestMatch.id,
                match_method: matchMethod,
                confidence_score: Math.min(1.0, parseFloat(bestConf.toFixed(2))),
                verified: false,
            });
            matched++;
        } else {
            skipped++;
        }
    }

    console.log(`Matched: ${matched}, Skipped: ${skipped}`);

    // Bulk insert in chunks of 500
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const { error } = await supabase.from('card_mappings').upsert(chunk, { onConflict: 'card_id_th' });
        if (error) console.error('Chunk error:', error);
        else { inserted += chunk.length; console.log(`Inserted ${inserted}/${toInsert.length}`); }
    }

    console.log('✅ Thai card matching complete!');
}

main().catch(console.error);
