require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function qcEnglishMarketData() {
    console.log('--- QC Market Data for English Sets ---');

    console.log('Fetching all English cards...');
    let enCards = [];
    let cPage = 0;
    while (true) {
        const { data: batch, error: batchErr } = await supabase
            .from('pokemon_cards')
            .select('id, set_id, name')
            .eq('language', 'en')
            .range(cPage * 1000, (cPage + 1) * 1000 - 1);

        if (batchErr || !batch || batch.length === 0) break;
        enCards = enCards.concat(batch);
        cPage++;
    }

    console.log(`Found ${enCards.length} English cards.`);

    // Group cards by set
    const setGroups = {};
    for (const c of enCards) {
        if (!setGroups[c.set_id]) setGroups[c.set_id] = { total: 0, withPrices: 0, latestUpdate: null };
        setGroups[c.set_id].total++;
    }

    const setIdsOrig = Object.keys(setGroups);
    console.log(`Found ${setIdsOrig.length} English sets with cards.`);

    const enCardMap = new Map();
    for (const c of enCards) {
        enCardMap.set(c.id, c.set_id);
    }

    // Fetch all market_values and filter memory
    console.log('Fetching all market_values...');
    let allMV = [];
    let page = 0;
    while (true) {
        const { data: batch, error: batchErr } = await supabase
            .from('market_values')
            .select('card_id, created_at, market_avg')
            .range(page * 1000, (page + 1) * 1000 - 1);

        if (batchErr) {
            console.error('Error fetching market values:', batchErr);
            break;
        }
        if (!batch || batch.length === 0) break;
        allMV = allMV.concat(batch);
        page++;
    }

    console.log(`Found ${allMV.length} total market values in DB.`);

    // Count matches
    let enPriceCount = 0;
    const now = new Date();

    for (const m of allMV) {
        if (enCardMap.has(m.card_id)) {
            enPriceCount++;
            const setId = enCardMap.get(m.card_id);
            setGroups[setId].withPrices++;

            const mDate = new Date(m.created_at);
            if (!setGroups[setId].latestUpdate || mDate > setGroups[setId].latestUpdate) {
                setGroups[setId].latestUpdate = mDate;
            }
        }
    }

    console.log(`Matched ${enPriceCount} market values to English cards.`);

    // 3. Print report
    console.log('\n--- Set Coverage Report ---');
    console.log('Set ID'.padEnd(10) | 'Total Cards'.padEnd(15) | 'Priced Cards'.padEnd(15) | 'Coverage'.padEnd(10) | 'Latest Update');
    console.log('-------------------------------------------------------------------------------------------------');

    const sortedSets = Object.keys(setGroups).sort();

    let totalEn = 0;
    let totalPriced = 0;

    for (const setId of sortedSets) {
        const info = setGroups[setId];
        const coverage = ((info.withPrices / info.total) * 100).toFixed(1) + '%';
        const dateStr = info.latestUpdate ? info.latestUpdate.toISOString().split('T')[0] : 'Never';

        totalEn += info.total;
        totalPriced += info.withPrices;

        console.log(
            setId.padEnd(10) + ' | ' +
            String(info.total).padEnd(13) + ' | ' +
            String(info.withPrices).padEnd(13) + ' | ' +
            coverage.padEnd(8) + ' | ' +
            dateStr
        );
    }

    console.log('-------------------------------------------------------------------------------------------------');
    console.log(`TOTAL EN CARDS: ${totalEn}, PRICED: ${totalPriced}, TOTAL COVERAGE: ${((totalPriced / totalEn) * 100).toFixed(1)}%`);
}

qcEnglishMarketData();
