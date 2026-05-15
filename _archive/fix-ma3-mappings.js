/**
 * Fix MA3 (Mega Dream Evolution EX) card mappings.
 * Uses UNIQUE(card_id_th) as the ON CONFLICT target.
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

async function main() {
    console.log('=== Fixing MA3 card mappings ===\n');

    // Step 1: Get all MA3 Thai card IDs
    const { data: thaiCards, error: thaiErr } = await sb
        .from('pokemon_cards')
        .select('id, name, number')
        .eq('set_id', 'MA3')
        .eq('language', 'th');
    if (thaiErr) throw new Error('Failed to fetch MA3 cards: ' + thaiErr.message);
    console.log(`Found ${thaiCards.length} MA3 Thai cards`);

    const thaiIds = thaiCards.map(c => c.id);

    // Step 2: Delete all existing mappings for MA3 Thai cards
    const { error: deleteErr, count: deleteCount } = await sb
        .from('card_mappings')
        .delete({ count: 'exact' })
        .in('card_id_th', thaiIds);
    if (deleteErr) throw new Error('Delete failed: ' + deleteErr.message);
    console.log(`Deleted ${deleteCount ?? '?'} existing MA3 mappings\n`);

    // Step 3: Get all me02.5 English cards
    const { data: enCards, error: enErr } = await sb
        .from('pokemon_cards')
        .select('id, name, number')
        .eq('set_id', 'me02.5')
        .eq('language', 'en');
    if (enErr) throw new Error('Failed to fetch me02.5 cards: ' + enErr.message);
    console.log(`Found ${enCards.length} me02.5 (Ascended Heroes) English cards`);

    // Build number lookup (strip leading zeros)
    const enByNumber = new Map();
    for (const c of enCards) {
        const num = String(c.number).replace(/^0+/, '');
        if (!enByNumber.has(num)) enByNumber.set(num, c);
        // Also store WITH leading zeros in case Thai uses them
        enByNumber.set(String(c.number), c);
    }

    // Step 4: Match Thai cards to English cards by number
    const rows = [];
    const unmatched = [];

    for (const thai of thaiCards) {
        const thaiNum = String(thai.number).replace(/^0+/, '');
        const en = enByNumber.get(thaiNum) || enByNumber.get(String(thai.number));

        if (en) {
            rows.push({
                card_id_th: thai.id,
                card_id_en: en.id,
                match_method: 'number_strict',
                confidence_score: 0.99,
                created_at: new Date().toISOString(),
            });
        } else {
            unmatched.push(`#${thai.number} ${thai.name}`);
        }
    }

    console.log(`\nMatched:   ${rows.length} cards`);
    console.log(`Unmatched: ${unmatched.length} cards`);
    if (unmatched.length > 0 && unmatched.length <= 20) {
        console.log('Unmatched Thai cards:');
        unmatched.forEach(m => console.log(' ', m));
    } else if (unmatched.length > 0) {
        console.log('First 10 unmatched:');
        unmatched.slice(0, 10).forEach(m => console.log(' ', m));
    }

    if (rows.length === 0) {
        console.log('\nNo rows to insert.');
        return;
    }

    // Step 5: Insert in batches — use card_id_th as the unique conflict key
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error: insErr } = await sb
            .from('card_mappings')
            .upsert(batch, { onConflict: 'card_id_th' });
        if (insErr) {
            console.error(`Insert batch ${i} failed:`, insErr.message);
        } else {
            inserted += batch.length;
        }
    }

    console.log(`\n✓ Inserted/updated ${inserted} mappings for MA3 → me02.5`);
    console.log('=== Done ===');
}

main().catch(console.error);
