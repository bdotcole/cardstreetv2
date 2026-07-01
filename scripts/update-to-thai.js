// Update existing sets from Japanese to Thai
// This will update the language tag and names for sets that match the CSV
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

function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
}

function detectSeries(setId) {
    if (setId.startsWith('MA')) return 'Mega Evolution';
    if (setId.startsWith('SV')) return 'Scarlet & Violet';
    if (setId.startsWith('SC')) return 'Sword & Shield';
    if (setId.startsWith('S')) return 'Sword & Shield';
    return 'Other';
}

async function updateToThai() {
    console.log('🔄 Updating existing sets to Thai language...\n');

    const csvPath = path.join(__dirname, '..', 'lib', 'thai database', 'Thai Set Tracker - Main.csv');
    const csvData = parseCSV(csvPath);

    const results = {
        updated: [],
        skipped: [],
        errors: []
    };

    for (const row of csvData) {
        const setId = row.id;
        const thaiName = row.name;

        // Check if set exists
        const { data: existing, error: fetchError } = await supabase
            .from('pokemon_sets')
            .select('*')
            .eq('id', setId)
            .single();

        if (fetchError || !existing) {
            console.log(`⏭️  ${setId}: Not found in database, skipping`);
            results.skipped.push(setId);
            continue;
        }

        // Skip if already Thai
        if (existing.language === 'th') {
            console.log(`✅ ${setId}: Already set to Thai, skipping`);
            results.skipped.push(setId);
            continue;
        }

        console.log(`\n🔄 Updating ${setId} from ${existing.language || 'NULL'} to 'th'`);
        console.log(`   Old name: ${existing.name}`);
        console.log(`   New name: ${thaiName}`);

        // Update the set
        const updateData = {
            name: thaiName,
            language: 'th',
            series: detectSeries(setId),
            printed_total: row.printed_total ? parseInt(row.printed_total) : existing.printed_total,
            total: row.total ? parseInt(row.total) : existing.total,
            release_date: parseDate(row.release_date) || existing.release_date,
            logo_url: row.logo_url || existing.logo_url
        };

        const { error: updateError } = await supabase
            .from('pokemon_sets')
            .update(updateData)
            .eq('id', setId);

        if (updateError) {
            console.error(`   ❌ Error: ${updateError.message}`);
            results.errors.push({ set: setId, error: updateError.message });
        } else {
            console.log(`   ✅ Updated successfully`);
            results.updated.push(setId);
        }
    }

    // Summary
    console.log('\n\n📊 Update Summary:');
    console.log('='.repeat(50));
    console.log(`✅ Updated: ${results.updated.length}`);
    console.log(`⏭️  Skipped: ${results.skipped.length}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    if (results.updated.length > 0) {
        console.log('\n✅ Updated sets:', results.updated.join(', '));
    }

    if (results.errors.length > 0) {
        console.log('\n❌ Errors:');
        results.errors.forEach(e => console.log(`   ${e.set}: ${e.error}`));
    }

    console.log('\n✨ Update complete!\n');
}

updateToThai().catch(console.error);
