const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key] = value.trim();
});

const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function checkBadData() {
    const { data, error } = await supabase.from('collection_items').select('id, card_data');
    if (error) console.error(error);

    let badCount = 0;
    let nullCount = 0;
    for (let item of data) {
        if (!item.card_data) {
            nullCount++;
            continue;
        }
        if (!item.card_data.name) {
            console.log("Missing name for item:", item.id, item.card_data);
            badCount++;
        }
    }
    console.log(`Checked ${data.length} items. Missing card_data sum: ${nullCount}. Missing name sum: ${badCount}`);
}

checkBadData();
