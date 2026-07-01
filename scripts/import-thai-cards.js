// Import Thai Pokemon Cards from CSV file
// Run with: node scripts/import-thai-cards.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of require('fs').readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Parse CSV file - handles commas within quoted fields
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // Parse header
    const headers = parseCSVLine(lines[0]);

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue;

        const row = {};
        headers.forEach((header, index) => {
            row[header.trim()] = values[index]?.trim() || '';
        });
        data.push(row);
    }

    return data;
}

// Parse a single CSV line, handling quoted fields
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);

    return result;
}

// Rarity mapping from CSV to database format
function mapRarity(csvRarity) {
    const rarityMap = {
        'C': 'Common',
        'U': 'Uncommon',
        'R': 'Rare',
        'RR': 'Double Rare',
        'RRR': 'Triple Rare',
        'SR': 'Secret Rare',
        'UR': 'Ultra Rare',
        'AR': 'Art Rare',
        'SAR': 'Special Art Rare',
        'MUR': 'Muster Rare',
        'BWR': 'Black & White Rare'
    };

    return rarityMap[csvRarity] || csvRarity;
}

async function importThaiCards() {
    console.log('🇹🇭 Starting Thai Cards Import...\n');

    // Read CSV file
    const csvPath = path.join(__dirname, '..', 'lib', 'thai database', 'Pokemon Cards Master List Complete - Sheet1.csv');
    console.log(`📁 Reading CSV from: ${csvPath}\n`);

    let csvData;
    try {
        csvData = parseCSV(csvPath);
    } catch (error) {
        console.error('❌ Error reading CSV file:', error.message);
        return;
    }

    if (csvData.length === 0) {
        console.error('❌ No data found in CSV file!');
        return;
    }

    console.log(`📊 Found ${csvData.length} cards to import\n`);

    // Get all existing Thai sets to validate against
    console.log('🔍 Fetching existing Thai sets...');
    const { data: existingSets, error: setsError } = await supabase
        .from('pokemon_sets')
        .select('id, name')
        .eq('language', 'th');

    if (setsError) {
        console.error('❌ Error fetching sets:', setsError.message);
        return;
    }

    const setIds = new Set((existingSets || []).map(s => s.id));
    console.log(`✅ Found ${setIds.size} Thai sets in database\n`);

    const results = {
        success: [],
        errors: [],
        skipped: [],
        missingSet: []
    };

    // Process cards in batches
    const BATCH_SIZE = 100;
    let batch = [];

    for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];
        const progress = `[${i + 1}/${csvData.length}]`;

        const setId = row['Set ID'];
        const thaiName = row['name'];
        const englishName = row['English Name'];
        const cardNumber = row['card #'];
        const rarity = row['rarity'];
        const imageUrl = row['image_url'];

        // Validate required fields
        if (!setId || !thaiName || !cardNumber) {
            console.error(`${progress} ❌ Missing required fields for card`);
            results.errors.push({ card: thaiName || 'unknown', error: 'Missing required fields' });
            continue;
        }

        // Check if set exists
        if (!setIds.has(setId)) {
            console.log(`${progress} ⚠️  Set ${setId} not found in database, skipping: ${thaiName}`);
            results.missingSet.push({ set: setId, card: thaiName });
            continue;
        }

        // Generate card ID: {set_id}-{card_number}
        const cardId = `${setId}-${cardNumber}`;

        // Check if card already exists
        const { data: existing } = await supabase
            .from('pokemon_cards')
            .select('id')
            .eq('id', cardId)
            .single();

        if (existing) {
            console.log(`${progress} ⏭️  Card already exists, skipping: ${englishName || thaiName}`);
            results.skipped.push(cardId);
            continue;
        }

        // Prepare card data
        const cardData = {
            id: cardId,
            name: thaiName,
            english_name: englishName || null,
            set_id: setId,
            number: cardNumber,
            supertype: 'Pokémon', // From CSV game column
            rarity: mapRarity(rarity),
            image_large: imageUrl,
            image_small: imageUrl, // Use same URL for both
            language: 'th'
        };

        batch.push(cardData);

        // Insert batch when it reaches BATCH_SIZE or at the end
        if (batch.length >= BATCH_SIZE || i === csvData.length - 1) {
            console.log(`\n📦 Inserting batch of ${batch.length} cards...`);

            const { data, error } = await supabase
                .from('pokemon_cards')
                .insert(batch)
                .select();

            if (error) {
                console.error(`❌ Batch insert error:`, error.message);
                batch.forEach(card => {
                    results.errors.push({ card: card.english_name || card.name, error: error.message });
                });
            } else {
                console.log(`✅ Successfully inserted ${batch.length} cards`);
                batch.forEach(card => results.success.push(card.id));
            }

            batch = [];
        } else {
            process.stdout.write(`${progress} Processing: ${englishName || thaiName}\r`);
        }
    }

    // Print summary
    console.log('\n\n📊 Import Summary:');
    console.log('=====================================');
    console.log(`✅ Successfully imported: ${results.success.length}`);
    console.log(`⏭️  Skipped (already exists): ${results.skipped.length}`);
    console.log(`⚠️  Missing sets: ${results.missingSet.length}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    if (results.missingSet.length > 0) {
        console.log('\n⚠️  Cards skipped due to missing sets:');
        const missingSets = {};
        results.missingSet.forEach(item => {
            if (!missingSets[item.set]) missingSets[item.set] = 0;
            missingSets[item.set]++;
        });
        Object.entries(missingSets).forEach(([set, count]) => {
            console.log(`   ${set}: ${count} cards`);
        });
    }

    if (results.errors.length > 0) {
        console.log('\n❌ Errors:');
        results.errors.slice(0, 10).forEach(e => console.log(`   ${e.card}: ${e.error}`));
        if (results.errors.length > 10) {
            console.log(`   ... and ${results.errors.length - 10} more errors`);
        }
    }

    console.log('\n✨ Import complete!\n');
}

// Run the import
importThaiCards().catch(console.error);
