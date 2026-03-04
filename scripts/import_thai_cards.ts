import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CsvRow {
    set: string;
    setId: string;
    name: string;
    englishName: string;
    number: string;
    rarity: string;
    imageUrl: string;
}

function parseCsv(filePath: string): CsvRow[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 8) continue;
        rows.push({
            set: cols[1]?.trim() || '',
            setId: cols[2]?.trim() || '',
            name: cols[3]?.trim() || '',
            englishName: cols[4]?.trim() || '',
            number: cols[5]?.trim() || '',
            rarity: cols[6]?.trim() || '',
            imageUrl: cols.slice(7).join(',').trim().replace(/\r$/, '') || '',
        });
    }
    return rows;
}

// Generate a deterministic UUID from set_id + number + language
// This guarantees idempotent imports: the same card always gets the same UUID
function deterministicUUID(setId: string, number: string, language: string): string {
    const hash = crypto.createHash('md5').update(`${setId}|${number}|${language}`).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        '4' + hash.slice(13, 16),
        (parseInt(hash[16], 16) & 3 | 8).toString(16) + hash.slice(17, 20),
        hash.slice(20, 32),
    ].join('-');
}

async function importCards() {
    const csvPath = path.resolve(
        'lib/thai database/Pokemon Cards Master List Complete - Sheet1 (1).csv'
    );

    if (!fs.existsSync(csvPath)) {
        console.error('CSV file not found at:', csvPath);
        process.exit(1);
    }

    const allRows = parseCsv(csvPath);
    console.log(`Loaded ${allRows.length} rows from CSV`);

    const bySet = new Map<string, CsvRow[]>();
    for (const row of allRows) {
        if (!row.setId) continue;
        const arr = bySet.get(row.setId) || [];
        arr.push(row);
        bySet.set(row.setId, arr);
    }

    // Get current DB counts per set
    const setStatusMap = new Map<string, number>();
    for (const setId of bySet.keys()) {
        const { count } = await supabase
            .from('pokemon_cards')
            .select('id', { count: 'exact', head: true })
            .eq('set_id', setId);
        setStatusMap.set(setId, count || 0);
    }

    console.log('\n=== SET STATUS ===');
    for (const [setId, rows] of bySet) {
        const dbCount = setStatusMap.get(setId) || 0;
        const csvCount = rows.length;
        const icon = dbCount === 0 ? '🔴 EMPTY' : (dbCount < csvCount ? '🟡 PARTIAL' : '✅ OK');
        console.log(`  ${setId}: ${icon} — CSV: ${csvCount}, DB: ${dbCount}`);
    }

    let totalInserted = 0;
    let totalErrors = 0;

    for (const [setId, rows] of bySet) {
        const dbCount = setStatusMap.get(setId) || 0;
        if (dbCount >= rows.length) {
            console.log(`\nSkipping ${setId} — already fully imported`);
            continue;
        }

        // Verify set exists
        const { data: setRecord } = await supabase
            .from('pokemon_sets')
            .select('id')
            .eq('id', setId)
            .single();
        if (!setRecord) {
            console.log(`\n⚠ Set ${setId} not found in pokemon_sets, skipping`);
            continue;
        }

        console.log(`\n--- Importing ${setId} (${rows.length} cards, DB has ${dbCount}) ---`);

        // Get existing card numbers that are already in DB for this set
        const { data: existingCards } = await supabase
            .from('pokemon_cards')
            .select('number')
            .eq('set_id', setId)
            .eq('language', 'th');
        const existingNumbers = new Set(existingCards?.map(c => c.number) || []);

        // Deduplicate rows by card number — keep last occurrence when CSV has duplicates
        const deduped = new Map<string, CsvRow>();
        for (const row of rows) {
            deduped.set(row.number, row); // last one wins (typically the highest rarity variant)
        }

        // Only import cards not yet in DB
        const toImport = [...deduped.values()].filter(row => !existingNumbers.has(row.number));
        console.log(`  ${toImport.length} new cards to import`);

        if (toImport.length === 0) {
            console.log(`  All cards already exist, skipping`);
            continue;
        }

        const cardRecords = toImport.map(row => ({
            id: deterministicUUID(setId, row.number, 'th'),
            set_id: row.setId,
            name: row.name,
            english_name: row.englishName,
            number: row.number,
            rarity: row.rarity,
            image_small: row.imageUrl,
            image_large: row.imageUrl,
            language: 'th',
            raw_data: {
                thai_name: row.name,
                english_name: row.englishName,
                set_name: row.set,
                csv_source: 'Pokemon Cards Master List Complete',
            },
        }));

        const batchSize = 200;
        let inserted = 0;
        for (let i = 0; i < cardRecords.length; i += batchSize) {
            const batch = cardRecords.slice(i, i + batchSize);
            const { data, error } = await supabase
                .from('pokemon_cards')
                .upsert(batch, { onConflict: 'id' })
                .select('id');

            if (error) {
                console.error(`  ✗ Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
                totalErrors += batch.length;
            } else {
                inserted += (data?.length || 0);
            }
        }

        console.log(`  ✓ Inserted ${inserted} cards into ${setId}`);
        totalInserted += inserted;
    }

    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`Total new cards inserted: ${totalInserted}`);
    console.log(`Total errors: ${totalErrors}`);
}

importCards();
