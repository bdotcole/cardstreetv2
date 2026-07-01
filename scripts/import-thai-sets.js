// Import Thai Pokemon Sets from CSV file
// Run with: node scripts/import-thai-sets.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
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

// Parse CSV file
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',');

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((header, index) => {
            row[header.trim()] = values[index]?.trim() || '';
        });
        data.push(row);
    }

    return data;
}

// Detect series from set ID
function detectSeries(setId) {
    if (setId.startsWith('MA')) return 'Mega Evolution';
    if (setId.startsWith('SV')) return 'Scarlet & Violet';
    if (setId.startsWith('SC')) return 'Sword & Shield';
    if (setId.startsWith('S')) return 'Sword & Shield';
    return 'Other';
}

// Parse date from M/D/YYYY format to YYYY-MM-DD
function parseDate(dateStr) {
    if (!dateStr) return null;

    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;

    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];

    return `${year}-${month}-${day}`;
}

async function importThaiSets() {
    console.log('🇹🇭 Starting Thai Sets Import...\n');

    // Read CSV file
    const csvPath = path.join(__dirname, '..', 'lib', 'thai database', 'Thai Set Tracker - Main.csv');
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

    console.log(`📊 Found ${csvData.length} sets to import\n`);

    const results = {
        success: [],
        errors: [],
        skipped: []
    };

    for (const row of csvData) {
        console.log(`\n🔄 Processing: ${row['english name']} (${row.id})`);

        const setId = row.id;
        const thaiName = row.name;
        const englishName = row['english name'];

        // Validate required fields
        if (!setId || !thaiName) {
            console.error(`  ❌ Missing required fields`);
            results.errors.push({ set: setId || 'unknown', error: 'Missing setId or thaiName' });
            continue;
        }

        // Check if set already exists
        const { data: existing } = await supabase
            .from('pokemon_sets')
            .select('id')
            .eq('id', setId)
            .single();

        if (existing) {
            console.log(`  ⏭️  Set already exists, skipping`);
            results.skipped.push(setId);
            continue;
        }

        // Prepare set data for insertion
        const setData = {
            id: setId,
            name: thaiName, // Use Thai name as primary name
            series: detectSeries(setId), // Auto-detect from ID
            printed_total: row.printed_total ? parseInt(row.printed_total) : null,
            total: row.total ? parseInt(row.total) : null,
            release_date: parseDate(row.release_date),
            logo_url: row.logo_url || null,
            language: 'th' // Set language for Thai sets
        };

        // Insert set
        const { data, error } = await supabase
            .from('pokemon_sets')
            .insert([setData])
            .select();

        if (error) {
            console.error(`  ❌ Error:`, error.message);
            results.errors.push({ set: setId, error: error.message });
        } else {
            console.log(`  ✅ Imported successfully`);
            console.log(`     Thai: ${thaiName}`);
            console.log(`     English: ${englishName}`);
            console.log(`     Series: ${setData.series}`);
            console.log(`     Cards: ${setData.total} (${setData.printed_total} printed)`);
            console.log(`     Release: ${setData.release_date || 'N/A'}`);
            results.success.push(setId);
        }
    }

    // Print summary
    console.log('\n\n📊 Import Summary:');
    console.log('=====================================');
    console.log(`✅ Successfully imported: ${results.success.length}`);
    console.log(`⏭️  Skipped (already exists): ${results.skipped.length}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    if (results.success.length > 0) {
        console.log('\n✅ Imported sets:', results.success.join(', '));
    }

    if (results.errors.length > 0) {
        console.log('\n❌ Errors:');
        results.errors.forEach(e => console.log(`   ${e.set}: ${e.error}`));
    }

    if (results.skipped.length > 0) {
        console.log('\n⏭️  Skipped:', results.skipped.join(', '));
    }

    console.log('\n✨ Import complete!\n');
}

// Run the import
importThaiSets().catch(console.error);
