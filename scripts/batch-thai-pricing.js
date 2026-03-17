const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const THB_MULTIPLIER = 35.85;
const EN_RATIO = 0.55; // 55% of English match

async function fetchAll(query) {
    let all = [], page = 0, PAGE = 1000;
    while (true) {
        const { data, error } = await query(page * PAGE, (page + 1) * PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        page++;
    }
    return all;
}

async function main() {
    console.log(`Starting Batch Thai Card Pricing (Multiplier: ${EN_RATIO}x EN price)`);

    // 1. Get all mappings (paginated)
    console.log('Fetching card mappings...');
    const mappings = await fetchAll((from, to) =>
        supabase.from('card_mappings')
            .select('card_id_th, card_id_en')
            .not('card_id_en', 'is', null)
            .range(from, to)
    );
    console.log(`Found ${mappings.length} Thai->English mappings.`);

    const enCardIds = [...new Set(mappings.map(m => m.card_id_en))];

    // 2. Get all English prices (paginated in chunks of 200 IDs)
    console.log(`Fetching prices for ${enCardIds.length} English cards...`);
    let enPrices = [];
    const ID_CHUNK = 200;
    for (let i = 0; i < enCardIds.length; i += ID_CHUNK) {
        const chunk = enCardIds.slice(i, i + ID_CHUNK);
        const { data, error } = await supabase
            .from('market_values')
            .select('card_id, market_avg, currency')
            .in('card_id', chunk)
            .eq('condition', 'Raw_NM');
        if (error) throw error;
        if (data) enPrices = enPrices.concat(data);
    }
    console.log(`Found ${enPrices.length} English prices.`);

    const priceMap = new Map();
    for (const p of enPrices) {
        priceMap.set(p.card_id, p);
    }

    // 3. Calculate Thai prices
    const toUpsert = [];
    let count = 0;

    for (const mapping of mappings) {
        const enPriceData = priceMap.get(mapping.card_id_en);
        if (!enPriceData || enPriceData.market_avg <= 0) continue;

        let basePriceUsd = enPriceData.market_avg;
        if (enPriceData.currency === 'THB') {
            basePriceUsd = basePriceUsd / THB_MULTIPLIER;
        }

        const calculatedThb = Math.max(10, basePriceUsd * EN_RATIO * THB_MULTIPLIER); // 10 THB minimum or calculated

        toUpsert.push({
            card_id: mapping.card_id_th,
            language: 'th',
            condition: 'Raw_NM',
            market_avg: calculatedThb,
            currency: 'THB',
            source_links: ['English Pricing Match (0.55x)'],
            source_prices: {
                method: 'en_0.55x',
                raw_calculated: calculatedThb,
                en_usd_price: basePriceUsd
            },
            last_updated: new Date().toISOString()
        });
        count++;
    }

    console.log(`Calculated prices for ${count} Thai cards. Upserting...`);

    // 4. Batch upsert
    const CHUNK = 500;
    let successCount = 0;

    for (let i = 0; i < toUpsert.length; i += CHUNK) {
        const chunk = toUpsert.slice(i, i + CHUNK);
        const { error: upsertErr } = await supabase
            .from('market_values')
            .upsert(chunk, { onConflict: 'card_id, language, condition' });

        if (upsertErr) {
            console.error('Error upserting chunk:', upsertErr);
        } else {
            successCount += chunk.length;
            console.log(`Upserted ${successCount}/${toUpsert.length}`);
        }
    }

    console.log('✅ Batch pricing complete!');
}

main().catch(console.error);
