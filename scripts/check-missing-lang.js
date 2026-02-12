// Check which sets from CSV exist without Thai language tag
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

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
