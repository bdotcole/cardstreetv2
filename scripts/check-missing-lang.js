// Check which sets from CSV exist without Thai language tag
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

async function checkMissingLanguageTags() {
    console.log('🔍 Checking for sets without Thai language tag...\n');

    const csvPath = path.join(__dirname, '..', 'lib', 'thai database', 'Thai Set Tracker - Main.csv');
    const csvData = parseCSV(csvPath);

    console.log(`📊 CSV has ${csvData.length} sets\n`);

    const missing = [];

    for (const row of csvData) {
        const { data, error } = await supabase
            .from('pokemon_sets')
            .select('id, name, language')
            .eq('id', row.id)
            .single();

        if (data) {
            if (data.language !== 'th') {
                missing.push({
                    id: data.id,
                    name: data.name,
                    currentLang: data.language
                });
            }
        }
    }

    console.log(`\n❌ Found ${missing.length} sets without 'th' language tag:\n`);
    missing.forEach(set => {
        console.log(`${set.id} | ${set.name} | Current: ${set.currentLang || 'NULL'}`);
    });
}

checkMissingLanguageTags().catch(console.error);
