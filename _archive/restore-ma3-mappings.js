/**
 * Restore MA3 card mappings by running the same logic as match-thai-cards locally.
 * Uses set_bridge to find the correct English set(s), then matches by:
 *   A. name similarity (using english_name field)
 *   B. number + rarity fallback
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8')
    .split('\n')
    .forEach(l => {
        const [k, ...v] = l.split('=');
        if (k && v.length) env[k.trim()] = v.join('=').trim();
    });

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

const RARITY_MAP = {
    'C': ['Common'],
    'U': ['Uncommon'],
    'R': ['Rare'],
    'RR': ['Double Rare', 'Double rare'],
    'SR': ['Ultra Rare'],
    'AR': ['Illustration Rare', 'Illustration rare'],
    'SAR': ['Special Illustration Rare', 'Special illustration rare'],
    'UR': ['Hyper Rare', 'Mega Hyper Rare'],
    'MA': [],
};
const NO_EN_RARITY = new Set(['PB', 'EH', 'MA']);

function mapRarityToEnglish(r) {
    if (NO_EN_RARITY.has(r)) return null;
    return RARITY_MAP[r] ?? [r];
}

function norm(s) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (a === b) return 1.0;
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.includes(shorter) && shorter.length / longer.length > 0.7) return 0.9;
    // Simple token overlap
    const setA = new Set(a.split(' '));
    const setB = new Set(b.split(' '));
    const inter = [...setA].filter(t => setB.has(t)).length;
    return inter / Math.max(setA.size, setB.size);
}

function normaliseNumber(n) {
    return String(n ?? '').replace(/^0+/, '').split('/')[0].trim();
}

async function main() {
    console.log('=== Restoring MA3 card mappings (local matching) ===\n');

    // Get set_bridge for MA3
    const { data: bridge, error: bridgeErr } = await sb
        .from('set_bridge')
        .select('thai_set_id, english_set_id')
        .eq('thai_set_id', 'MA3');
    if (bridgeErr) throw new Error('set_bridge: ' + bridgeErr.message);

    const enSetIds = bridge.filter(r => r.english_set_id).map(r => r.english_set_id);
    console.log(`set_bridge: MA3 → [${enSetIds.join(', ')}]`);

    if (!enSetIds.length) {
        console.error('No English set mapped for MA3 in set_bridge!');
        return;
    }

    // Get all MA3 Thai cards
    const { data: thaiCards, error: thaiErr } = await sb
        .from('pokemon_cards')
        .select('id, name, english_name, number, rarity, set_id')
        .eq('set_id', 'MA3')
        .eq('language', 'th');
    if (thaiErr) throw new Error(thaiErr.message);
    console.log(`Found ${thaiCards.length} MA3 Thai cards`);

    // Get English candidate cards
    const { data: enCards, error: enErr } = await sb
        .from('pokemon_cards')
        .select('id, name, number, rarity, set_id')
        .eq('language', 'en')
        .in('set_id', enSetIds);
    if (enErr) throw new Error(enErr.message);
    console.log(`Found ${enCards.length} English candidate cards from [${enSetIds.join(', ')}]\n`);

    const toInsert = [];
    let matched = 0, skipped = 0;

    for (const thai of thaiCards) {
        const thaiNum = normaliseNumber(thai.number);
        const englishRarities = mapRarityToEnglish(thai.rarity);
        const searchName = norm(thai.english_name ?? thai.name ?? '');

        let bestMatch = null;
        let bestConfidence = 0;
        let matchMethod = '';

        // (A) Name similarity - primary method since numbers don't align between Thai/EN sets
        if (searchName) {
            for (const en of enCards) {
                const sim = similarity(searchName, en.name);
                if (sim > bestConfidence) {
                    // Also require rarity match if we have a mapping
                    const enRarities = englishRarities;
                    const rarityOk = !enRarities || enRarities.length === 0 ||
                        enRarities.some(r => r.toLowerCase() === (en.rarity ?? '').toLowerCase());

                    if (rarityOk && sim >= 0.75) {
                        bestConfidence = sim;
                        bestMatch = en;
                        matchMethod = 'name_fuzzy';
                    }
                }
            }
        }

        // (B) If name match is strong enough, use it; if not, try name without rarity filter
        if (bestConfidence < 0.85 && searchName) {
            for (const en of enCards) {
                const sim = similarity(searchName, en.name);
                if (sim > bestConfidence && sim >= 0.85) {
                    bestConfidence = sim;
                    bestMatch = en;
                    matchMethod = 'name_fuzzy_no_rarity';
                }
            }
        }

        if (bestMatch && bestConfidence >= 0.75) {
            toInsert.push({
                card_id_th: thai.id,
                card_id_en: bestMatch.id,
                match_method: matchMethod,
                confidence_score: Math.min(1.0, parseFloat(bestConfidence.toFixed(2))),
                verified: false,
            });
            matched++;
            if (matched <= 10) {
                console.log(`  ✓ #${thai.number} "${thai.english_name ?? thai.name}" [${thai.rarity}] → "${bestMatch.name}" [${bestMatch.rarity}] (${bestConfidence.toFixed(2)}, ${matchMethod})`);
            }
        } else {
            skipped++;
            if (skipped <= 5) {
                console.log(`  ✗ #${thai.number} "${thai.english_name ?? thai.name}" [${thai.rarity}] - no match (best: ${bestConfidence.toFixed(2)})`);
            }
        }
    }

    console.log(`\nMatched: ${matched}, Skipped: ${skipped}`);

    if (toInsert.length === 0) {
        console.log('Nothing to insert.');
        return;
    }

    // Insert in batches
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const { error: insErr } = await sb
            .from('card_mappings')
            .upsert(batch, { onConflict: 'card_id_th' });
        if (insErr) {
            console.error(`Batch ${i} failed:`, insErr.message);
        } else {
            inserted += batch.length;
        }
    }

    console.log(`✓ Inserted ${inserted} mappings for MA3`);
}

main().catch(console.error);
