const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[match[1].trim()] = value;
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function patch() {
    const { data: sets } = await supabase.from('pokemon_sets').select('id, printed_total').in('id', ['MA1', 'MA2', 'MA3', 'SV10s', 'SV11s', 'SV9s', 'SV1V', 'SV1S', 'SV2D', 'SV2P', 'SV5K', 'SV5M']);
    console.log(`Found ${sets.length} sets`);
    for (const set of sets) {
        const { data: cards } = await supabase.from('pokemon_cards').select('id, raw_data').eq('set_id', set.id);
        console.log(`Patching ${cards.length} cards in ${set.id}...`);

        let batchCount = 0;
        for (const card of cards) {
            const raw = card.raw_data || {};
            const setObj = raw.set || {};
            setObj.printedTotal = set.printed_total;
            raw.set = setObj;

            await supabase.from('pokemon_cards').update({ raw_data: raw }).eq('id', card.id);
            batchCount++;
            if (batchCount % 50 === 0) console.log(`  patched ${batchCount}/${cards.length}`);
        }
        console.log(`Done patching ${set.id}.`);
    }
}
patch();
