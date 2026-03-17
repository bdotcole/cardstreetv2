/**
 * fix-remaining-ma3.js
 * Force-inserts correct card_mappings for the remaining unmapped MA3 Thai high-rarity cards.
 * Uses EXACT me02.5 card numbers confirmed from the full card list.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname,'..', '.env.local'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g,'');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Manual mapping: match by EXACT me02.5 card number
// Confirmed from full me02.5 card list dump
const MANUAL_MAPS = [
    // Thai AR "Mimikyu-disguised" (#205) → EN Illustration Rare "Team Rocket's Mimikyu" (me02.5 #238)
    { th_english_name: 'Mimikyu-disguised',  th_set: 'MA3', th_rarity: 'AR',  en_number: '238', en_set: 'me02.5' },
    // Thai SAR "Morgrem ex" (#243) → EN SIR "Marnie's Grimmsnarl ex" (me02.5 #287)
    { th_english_name: 'Morgrem ex',          th_set: 'MA3', th_rarity: 'SAR', en_number: '287', en_set: 'me02.5' },
    // Thai SR "N's Elixir" (#214) → EN Ultra Rare "N's PP Up" (me02.5 #262)
    { th_english_name: "N's Elixir",          th_set: 'MA3', th_rarity: 'SR',  en_number: '262', en_set: 'me02.5', th_number: '214' },
    // Thai SR "Karate Pro Training" (#220) → EN Ultra Rare "Black Belt's Training" (me02.5 #255)
    { th_english_name: 'Karate Pro Training',  th_set: 'MA3', th_rarity: 'SR',  en_number: '255', en_set: 'me02.5' },
    // Thai SR "Verbena & Helena" (#221) → EN Ultra Rare "Anthea & Concordia" (me02.5 #254)
    { th_english_name: 'Verbena & Helena',     th_set: 'MA3', th_rarity: 'SR',  en_number: '254', en_set: 'me02.5' },
];

async function main() {
    const toUpsert = [];

    for (const map of MANUAL_MAPS) {
        // Find the Thai card
        let thQuery = supabase.from('pokemon_cards')
            .select('id, name, english_name, rarity, number')
            .eq('set_id', map.th_set).eq('language', 'th')
            .eq('english_name', map.th_english_name).eq('rarity', map.th_rarity);
        if (map.th_number) thQuery = thQuery.eq('number', map.th_number);
        const { data: thCards } = await thQuery;

        if (!thCards?.length) {
            console.log(`  WARN: Thai card not found: "${map.th_english_name}" (${map.th_rarity}) in ${map.th_set}`);
            continue;
        }

        // Find the EN card by exact number in the EN set
        const { data: enCards } = await supabase.from('pokemon_cards')
            .select('id, name, rarity, number')
            .eq('set_id', map.en_set).eq('language', 'en').eq('number', map.en_number);

        if (!enCards?.length) {
            console.log(`  WARN: EN card not found: #${map.en_number} in ${map.en_set}`);
            continue;
        }

        const enCard = enCards[0];
        for (const th of thCards) {
            console.log(`  MAP: [${th.rarity}] "${th.english_name}" (#${th.number}) → "${enCard.name}" (${enCard.rarity}) #${enCard.number}`);
            toUpsert.push({
                card_id_th: th.id,
                card_id_en: enCard.id,
                match_method: 'manual_confirmed',
                confidence_score: 0.92,
                verified: true,
            });
        }
    }

    if (!toUpsert.length) { console.log('Nothing to upsert.'); return; }

    console.log(`\nUpserting ${toUpsert.length} mappings...`);
    const { error } = await supabase.from('card_mappings')
        .upsert(toUpsert, { onConflict: 'card_id_th' });
    if (error) console.error('Error:', error);
    else console.log('✅ Done!');
}
main().catch(console.error);
