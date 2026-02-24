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

    let count = 0;
    for (let item of data) {
        if (!item.card_data || !item.card_data.name || !item.card_data.set || !item.card_data.number) {
            console.log("Missing properties for item:", item.id, item.card_data);
            count++;
        }
    }
    console.log(`Checked ${data.length} items. Malformed sum: ${count}`);
}

checkBadData();
