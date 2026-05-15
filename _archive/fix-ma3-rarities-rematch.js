/**
 * Fix MA3 card rarities from the master CSV, then delete existing mappings
 * and re-run name+rarity matching against me02.5 (Ascended Heroes).
 * 
 * CSV format (tab-separated):
 *   game  Set  Set ID  name  English Name  card #  rarity  image_url
 * 
 * Each card number can appear up to 3 times in the CSV (regular, PB, EH variants).
 * The DB also has up to 3 rows per card number — matched by sort order of ID.
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

// Rarity equivalents for matching logic
const RARITY_MAP = {
    'C': ['Common'],
    'U': ['Uncommon'],
    'R': ['Rare'],
    'RR': ['Double Rare', 'Double rare'],
    'SR': ['Ultra Rare'],
    'AR': ['Illustration Rare', 'Illustration rare'],
    'SAR': ['Special Illustration Rare', 'Special illustration rare'],
    'UR': ['Hyper Rare', 'Mega Hyper Rare'],
    'MA': ['Mega Hyper Rare'],
    'MUR': ['Mega Hyper Rare'],
    'เทรนเนอร์': [],  // Trainer — no EN rarity filter
    'TR': [],
    'PB': [],
    'EH': [],
    'ER': [],
};
const NO_EN_RARITY = new Set(['PB', 'EH', 'ER', 'MA', 'MUR', 'เทรนเนอร์', 'TR']);

function mapRarityToEnglish(r) {
    if (NO_EN_RARITY.has(r)) return null;
    return RARITY_MAP[r] ?? [r];
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

async function main() {
    console.log('=== Fix MA3 rarities + re-match ===\n');

    // ─── 1. Parse CSV for MA3 rows ──────────────────────────────────────────
    const rawCsv = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = rawCsv.split('\n').map(l => l.trim()).filter(Boolean);

    // MA3 rows can be tab or comma separated — handle both
    const ma3Rows = [];
    for (const line of lines.slice(1)) { // skip header
        const cols = line.includes('\t') ? line.split('\t') : line.split(',');
        if (cols.length < 7) continue;
        const [game, set, setId, name, englishName, cardNum, rarity] = cols.map(c => c.trim().replace(/^"|"$/g, ''));
        if (setId !== 'MA3') continue;
        const numOnly = cardNum.split('/')[0].replace(/^0+/, '');
        ma3Rows.push({ name, englishName, numOnly, rarity });
    }

    // Group by card number — each group has 1-3 rarity variants
    const byNum = {};
    for (const row of ma3Rows) {
        if (!byNum[row.numOnly]) byNum[row.numOnly] = [];
        byNum[row.numOnly].push(row);
    }
    console.log(`CSV: ${ma3Rows.length} MA3 rows covering ${Object.keys(byNum).length} unique card numbers`);

    // ─── 2. Fetch all MA3 DB cards ─────────────────────────────────────────
    const { data: dbCards, error: dbErr } = await sb
        .from('pokemon_cards')
        .select('id, number, name, english_name, rarity')
        .eq('set_id', 'MA3')
        .eq('language', 'th')
        .order('id');
    if (dbErr) throw new Error(dbErr.message);
    console.log(`DB: ${dbCards.length} MA3 Thai cards\n`);

    // Group DB cards by number
    const dbByNum = {};
    for (const c of dbCards) {
        const num = String(c.number).replace(/^0+/, '');
        if (!dbByNum[num]) dbByNum[num] = [];
        dbByNum[num].push(c);
    }

    // ─── 3. Update rarities ────────────────────────────────────────────────
    let updateCount = 0, skipCount = 0;
    const cardNewRarity = {}; // id → new rarity (for matching step)

    for (const [num, csvVariants] of Object.entries(byNum)) {
        const dbVariants = dbByNum[num] ?? [];

        if (dbVariants.length === 0) {
            // Extended range cards (194+) not yet in DB or no match
            continue;
        }

        // Match up CSV variants to DB variants by position (both sorted consistently)
        // DB is sorted by id (stable), CSV appears in order: regular first, then PB, EH
        const minLen = Math.min(csvVariants.length, dbVariants.length);

        for (let i = 0; i < minLen; i++) {
            const csvRarity = csvVariants[i].rarity;
            const dbCard = dbVariants[i];

            cardNewRarity[dbCard.id] = csvRarity;

            if (dbCard.rarity !== csvRarity) {
                const { error } = await sb.from('pokemon_cards')
                    .update({ rarity: csvRarity })
                    .eq('id', dbCard.id);
                if (error) {
                    console.error(`  ✗ #${num}[${i}] ${dbCard.id}: ${error.message}`);
                } else {
                    updateCount++;
                }
            } else {
                skipCount++;
            }
        }
    }
    console.log(`Rarity updates: ${updateCount} changed, ${skipCount} already correct\n`);

    // ─── 4. Delete all existing MA3 mappings ───────────────────────────────
    const allThaiIds = dbCards.map(c => c.id);
    const { error: delErr, count: delCount } = await sb
        .from('card_mappings')
        .delete({ count: 'exact' })
        .in('card_id_th', allThaiIds);
    if (delErr) throw new Error('Delete failed: ' + delErr.message);
    console.log(`Deleted ${delCount ?? '?'} existing MA3 mappings\n`);

    // ─── 5. Fetch English candidate cards from me02.5 ──────────────────────
    const { data: enCards, error: enErr } = await sb
        .from('pokemon_cards')
        .select('id, name, number, rarity, set_id')
        .eq('language', 'en')
        .eq('set_id', 'me02.5');
    if (enErr) throw new Error(enErr.message);
    console.log(`English pool: ${enCards.length} me02.5 cards\n`);

    // ─── 6. Re-run matching with corrected rarities ────────────────────────
    // Reload cards with fresh rarities
    const { data: freshCards } = await sb
        .from('pokemon_cards')
        .select('id, name, english_name, number, rarity')
        .eq('set_id', 'MA3')
        .eq('language', 'th');

    const toInsert = [];
    let matched = 0, skipped = 0;

    for (const thai of freshCards) {
        const englishRarities = mapRarityToEnglish(thai.rarity);
        const searchName = norm(thai.english_name ?? thai.name ?? '');
        if (!searchName) { skipped++; continue; }

        let bestMatch = null;
        let bestConfidence = 0;
        let matchMethod = '';

        // Strategy A: name + rarity match
        if (englishRarities && englishRarities.length > 0) {
            for (const en of enCards) {
                const rarityOk = englishRarities.some(r => r.toLowerCase() === (en.rarity ?? '').toLowerCase());
                if (!rarityOk) continue;
                const sim = similarity(searchName, en.name);
                if (sim > bestConfidence && sim >= 0.75) {
                    bestConfidence = sim;
                    bestMatch = en;
                    matchMethod = 'name_rarity';
                }
            }
        }

        // Strategy B: name only (for PB/EH/trainer/MA with no EN rarity filter)
        if (!bestMatch && searchName) {
            for (const en of enCards) {
                const sim = similarity(searchName, en.name);
                if (sim > bestConfidence && sim >= 0.85) {
                    bestConfidence = sim;
                    bestMatch = en;
                    matchMethod = 'name_fuzzy';
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
        } else {
            skipped++;
        }
    }

    console.log(`Matching: ${matched} matched, ${skipped} skipped`);

    // Sample output
    const samples = toInsert.slice(0, 5);
    for (const s of samples) {
        const th = freshCards.find(c => c.id === s.card_id_th);
        const en = enCards.find(c => c.id === s.card_id_en);
        console.log(`  ✓ "${th?.english_name ?? th?.name}" [${th?.rarity}] → "${en?.name}" [${en?.rarity}] (${s.confidence_score}, ${s.match_method})`);
    }

    // ─── 7. Upsert new mappings ────────────────────────────────────────────
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const { error } = await sb.from('card_mappings')
            .upsert(batch, { onConflict: 'card_id_th' });
        if (error) console.error(`Batch ${i} failed:`, error.message);
        else inserted += batch.length;
    }

    console.log(`\n✓ Inserted ${inserted} mappings for MA3`);
    console.log('=== Done ===');
}

main().catch(console.error);
