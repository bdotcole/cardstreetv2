/**
 * Ingest Thai cards from Pokemon Cards Master List Complete CSV into DB.
 * - Upserts all cards into pokemon_cards (skips if already correct)
 * - Runs name+rarity matching for cards WITH rarities
 * - Sets 10 baht price for cards WITHOUT rarities
 * 
 * Rarity mapping:
 *   S   → Shiny Rare
 *   SSR → Shiny Ultra Rare
 *   PB/EH/ER → name-only match (no EN rarity filter)
 *   เทรนเนอร์/TR/Trainer → Trainer (no match)
 *   (none) → no rarity, default 10 baht price
 */

const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8')
    .split('\n').forEach(l => {
        const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
    });

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

const CSV_PATH = path.join(__dirname, 'lib', 'thai database', 'Pokemon Cards Master List Complete - Sheet1 (1).csv');

// ── Rarity mapping CSV → DB ──────────────────────────────────────────────────
const RARITY_DB_MAP = {
    'C': 'Common',
    'U': 'Uncommon',
    'R': 'Rare',
    'RR': 'Double Rare',
    'SR': 'Ultra Rare',
    'UR': 'Hyper Rare',
    'AR': 'Illustration Rare',
    'SAR': 'Special Illustration Rare',
    'ACE': 'ACE SPEC Rare',
    'S': 'Shiny Rare',
    'SSR': 'Shiny Ultra Rare',
    'MUR': 'Mega Hyper Rare',
    'MA': 'Mega Hyper Rare',
    'BWR': 'Black & White Rare',
    'PB': 'PB',
    'EH': 'EH',
    'ER': 'ER',
    'เทรนเนอร์': 'Trainer',
    'Trainer': 'Trainer',
    'TR': 'Trainer',
    'URR': 'Ultra Rare',
    '': '',
};

// Rarities that can be matched to English cards by name only (no EN rarity filter)
const NAME_ONLY_RARITIES = new Set(['PB', 'EH', 'ER', 'MA', 'MUR', 'เทรนเนอร์', 'Trainer', 'TR', 'BWR', 'SSR']);
// Rarities with no English equivalent match possible
const NO_MATCH_RARITIES = new Set(['เทรนเนอร์', 'Trainer', 'TR', '']);

// EN rarity labels for each Thai rarity
const EN_RARITY_MAP = {
    'C': ['Common'],
    'U': ['Uncommon'],
    'R': ['Rare'],
    'RR': ['Double Rare', 'Double rare'],
    'SR': ['Ultra Rare'],
    'UR': ['Hyper Rare'],
    'AR': ['Illustration Rare', 'Illustration rare'],
    'SAR': ['Special Illustration Rare', 'Special illustration rare'],
    'ACE': ['ACE SPEC Rare'],
    'S': ['Shiny Rare'],
    'SSR': ['Shiny Ultra Rare'],
};

function dbRarity(r) { return RARITY_DB_MAP[r] ?? r; }

function enRarities(r) {
    if (NO_MATCH_RARITIES.has(r)) return null;      // no matching
    if (NAME_ONLY_RARITIES.has(r)) return [];        // name-only match
    return EN_RARITY_MAP[r] ?? null;
}

function norm(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (a === b) return 1.0;
    if (!a || !b) return 0;
    const tokA = new Set(a.split(' ').filter(Boolean));
    const tokB = new Set(b.split(' ').filter(Boolean));
    const inter = [...tokA].filter(t => tokB.has(t)).length;
    return inter / Math.max(tokA.size, tokB.size);
}

// ── Parse CSV ────────────────────────────────────────────────────────────────
function parseCSV() {
    const raw = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const rows = [];
    for (const line of lines.slice(1)) {
        const cols = line.includes('\t') ? line.split('\t') : line.split(',');
        if (cols.length < 6) continue;
        const [game, set, setId, name, englishName, cardNum, rarity, imageUrl] = cols.map(c => c.trim().replace('\r', ''));
        if (!setId || setId === 'Set ID') continue;
        rows.push({ game, set, setId, name, englishName, cardNum, rarity: rarity || '', imageUrl: imageUrl || '' });
    }
    return rows;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Ingest Thai Cards from CSV ===\n');
    const rows = parseCSV();
    console.log(`CSV: ${rows.length} rows\n`);

    // Get existing pokemon_sets for Thai
    const { data: sets } = await sb.from('pokemon_sets').select('id').eq('language', 'th');
    const validSetIds = new Set(sets.map(s => s.id));
    console.log(`Valid Thai sets in DB: ${validSetIds.size}`);

    // Get existing card IDs in DB
    const { data: existingCards } = await sb.from('pokemon_cards').select('id').eq('language', 'th');
    const existingIds = new Set(existingCards.map(c => c.id));
    console.log(`Existing Thai cards: ${existingIds.size}\n`);

    // ── 1. Build card insert list ───────────────────────────────────────────
    const toInsert = [];
    const skipped = [];
    const missingSet = [];

    for (const row of rows) {
        const numStr = row.cardNum.split('/')[0];
        const cardId = `${row.setId}-${numStr}`;

        if (!validSetIds.has(row.setId)) {
            missingSet.push(row.setId);
            continue;
        }
        if (existingIds.has(cardId)) {
            skipped.push(cardId);
            continue;
        }

        toInsert.push({
            id: cardId,
            name: row.name,
            english_name: row.englishName || null,
            set_id: row.setId,
            number: numStr,
            supertype: 'Pokémon',
            rarity: dbRarity(row.rarity),
            image_large: row.imageUrl || null,
            image_small: row.imageUrl || null,
            language: 'th',
        });
        existingIds.add(cardId); // prevent duplicates from same CSV
    }

    console.log(`To insert: ${toInsert.length} | Existing (skip): ${skipped.length} | Missing set: ${[...new Set(missingSet)].join(', ')}`);

    // ── 2. Batch insert ─────────────────────────────────────────────────────
    let inserted = 0;
    const BATCH = 100;
    for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH);
        const { error } = await sb.from('pokemon_cards').insert(batch);
        if (error) {
            console.error(`Batch ${i}-${i + BATCH} error:`, error.message);
        } else {
            inserted += batch.length;
            process.stdout.write(`  Inserted ${inserted}/${toInsert.length}\r`);
        }
    }
    console.log(`\n✓ Inserted ${inserted} new cards\n`);

    // ── 3. Price default: 10 baht for cards with no rarity ─────────────────
    // Reload newly inserted cards with no rarity
    const { data: noRarityCards } = await sb.from('pokemon_cards')
        .select('id')
        .eq('language', 'th')
        .or('rarity.is.null,rarity.eq.');

    console.log(`Cards with no rarity: ${noRarityCards?.length ?? 0}`);

    // Check if market_prices table exists and upsert 10 baht prices
    if (noRarityCards && noRarityCards.length > 0) {
        const priceRows = noRarityCards.map(c => ({
            card_id: c.id,
            price: 10,
            currency: 'THB',
            source: 'default',
        }));
        for (let i = 0; i < priceRows.length; i += BATCH) {
            const batch = priceRows.slice(i, i + BATCH);
            await sb.from('market_prices').upsert(batch, { onConflict: 'card_id' });
        }
        console.log(`✓ Set 10 baht default price for ${priceRows.length} no-rarity cards\n`);
    }

    // ── 4. Matching: cards with rarities → match against English sets ────────
    // Get all Thai cards that have a rarity and no mapping yet
    const { data: thaiCardsToMatch } = await sb.from('pokemon_cards')
        .select('id, name, english_name, set_id, rarity')
        .eq('language', 'th')
        .not('rarity', 'is', null)
        .not('rarity', 'eq', '')
        .not('rarity', 'eq', 'Trainer');

    // Get cards already mapped
    const { data: alreadyMapped } = await sb.from('card_mappings').select('card_id_th');
    const mappedIds = new Set((alreadyMapped || []).map(m => m.card_id_th));

    const unmapped = (thaiCardsToMatch || []).filter(c => !mappedIds.has(c.id));
    console.log(`Thai cards with rarity, needing match: ${unmapped.length}`);

    // Get set_bridge for all Thai sets
    const { data: bridges } = await sb.from('set_bridge').select('thai_set_id, english_set_id');
    const bridgeMap = {};
    (bridges || []).forEach(b => {
        if (!bridgeMap[b.thai_set_id]) bridgeMap[b.thai_set_id] = [];
        bridgeMap[b.thai_set_id].push(b.english_set_id);
    });

    // Get all English cards grouped by set
    const enSetIds = [...new Set(Object.values(bridgeMap).flat())];
    console.log(`English sets in bridge: ${enSetIds.length}`);

    const enCardsBySet = {};
    for (const setId of enSetIds) {
        const { data } = await sb.from('pokemon_cards')
            .select('id, name, rarity, number, set_id')
            .eq('set_id', setId)
            .eq('language', 'en');
        enCardsBySet[setId] = data || [];
    }

    // Match each Thai card
    const mappings = [];
    let matchCount = 0, skipCount = 0;

    for (const thai of unmapped) {
        const enSets = bridgeMap[thai.set_id] || [];
        if (enSets.length === 0) { skipCount++; continue; }

        const candidates = enSets.flatMap(s => enCardsBySet[s] || []);
        if (candidates.length === 0) { skipCount++; continue; }

        // Determine Thai rarity key (reverse lookup from DB value)
        const thaiRarityKey = Object.entries(RARITY_DB_MAP).find(([, v]) => v === thai.rarity)?.[0] || thai.rarity;
        const englishRarities = enRarities(thaiRarityKey);

        if (englishRarities === null) { skipCount++; continue; } // Trainer/no-match

        const searchName = norm(thai.english_name ?? thai.name ?? '');
        if (!searchName) { skipCount++; continue; }

        let bestMatch = null, bestSim = 0, matchMethod = '';

        // Strategy A: name + rarity
        if (englishRarities.length > 0) {
            for (const en of candidates) {
                const rarityOk = englishRarities.some(r => r.toLowerCase() === (en.rarity || '').toLowerCase());
                if (!rarityOk) continue;
                const sim = similarity(searchName, en.name);
                if (sim > bestSim && sim >= 0.75) {
                    bestSim = sim; bestMatch = en; matchMethod = 'name_rarity';
                }
            }
        }

        // Strategy B: name only (for PB/EH/ER/etc.)
        if (!bestMatch) {
            for (const en of candidates) {
                const sim = similarity(searchName, en.name);
                if (sim > bestSim && sim >= 0.85) {
                    bestSim = sim; bestMatch = en; matchMethod = 'name_fuzzy';
                }
            }
        }

        if (bestMatch) {
            mappings.push({
                card_id_th: thai.id,
                card_id_en: bestMatch.id,
                match_method: matchMethod,
                confidence_score: parseFloat(Math.min(1, bestSim).toFixed(2)),
                verified: false,
            });
            matchCount++;
        } else {
            skipCount++;
        }
    }

    console.log(`Matching: ${matchCount} matched, ${skipCount} skipped`);

    // Upsert mappings
    let mappedCount = 0;
    for (let i = 0; i < mappings.length; i += BATCH) {
        const batch = mappings.slice(i, i + BATCH);
        const { error } = await sb.from('card_mappings').upsert(batch, { onConflict: 'card_id_th' });
        if (!error) mappedCount += batch.length;
        else console.error('Mapping batch error:', error.message);
    }
    console.log(`✓ Inserted ${mappedCount} new mappings\n`);

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('=== Done ===');
    console.log(`Cards inserted: ${inserted}`);
    console.log(`Mappings created: ${mappedCount}`);
    console.log(`No-rarity (10 baht default): ${noRarityCards?.length ?? 0}`);
}

main().catch(console.error);
