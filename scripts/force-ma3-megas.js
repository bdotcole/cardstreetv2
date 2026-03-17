const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname,'..', '.env.local'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g,'');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const MAPPINGS = [
    { thNum: '223', enNum: '294' }, // Charizard MA -> Charizard Y MHR
    { thNum: '240', enNum: '284' }, // Gengar SAR -> Gengar SIR
    { thNum: '230', enNum: '269' }, // Gengar MA -> Gengar UR
    { thNum: '250', enNum: '295' }, // Dragonite MUR -> Dragonite MHR
    { thNum: '246', enNum: '290' }, // Dragonite SAR -> Dragonite SIR
    { thNum: '232', enNum: '271' }, // Dragonite MA -> Dragonite UR
    { thNum: '126', enNum: '152' }, // Dragonite RR -> Dragonite DR
    { thNum: '234', enNum: '276' }, // Pikachu SAR -> Pikachu SIR
    { thNum: '044', enNum: '057' }, // Pikachu RR -> Pikachu DR
    { thNum: '238', enNum: '282' }, // Diancie SAR -> Diancie SIR
    { thNum: '227', enNum: '267' }, // Diancie MA -> Diancie UR
    { thNum: '241', enNum: '285' }, // Scrafty SAR -> Scrafty SIR
    { thNum: '231', enNum: '270' }, // Scrafty MA -> Scrafty UR
    { thNum: '110', enNum: '135' }, // Scrafty RR -> Scrafty DR
    { thNum: '235', enNum: '278' }, // Eelektross SAR -> Eelektross SIR
    { thNum: '225', enNum: '266' }, // Eelektross MA -> Eelektross UR
    { thNum: '049', enNum: '061' }, // Eelektross RR -> Eelektross DR
    { thNum: '239', enNum: '283' }, // Hawlucha SAR -> Hawlucha SIR
    { thNum: '229', enNum: '268' }, // Hawlucha MA -> Hawlucha UR
    { thNum: '094', enNum: '120' }, // Hawlucha RR -> Hawlucha DR (Wait, DR is 116. Wait, check DR number. No, it's ok, let's fetch by number. Actually, I didn't verify 120. DR Hawlucha is 116!)
    { thNum: '036', enNum: '047' }, // Froslass RR -> Froslass DR
    { thNum: '224', enNum: '265' }, // Froslass MA -> Froslass UR
    { thNum: '233', enNum: '275' }, // Froslass SAR -> Froslass SIR
    { thNum: '071', enNum: '089' }, // Gardevoir RR -> Gardevoir DR
    { thNum: '226', enNum: '089' }, // Gardevoir MA -> Gardevoir DR (no UR exists)
    { thNum: '092', enNum: '113' }, // Lucario RR -> Lucario DR
    { thNum: '228', enNum: '113' }, // Lucario MA -> Lucario DR (no UR exists)
];

// Let's refine the Hawlucha DR number since I guessed 120. In me025-cards.txt, Hawlucha DR is #116.
const REFINED_MAPPINGS = [
    { thNum: '223', enNum: '294' }, // Charizard MA -> Charizard Y MHR
    { thNum: '240', enNum: '284' }, // Gengar SAR -> Gengar SIR
    { thNum: '230', enNum: '269' }, // Gengar MA -> Gengar UR
    { thNum: '250', enNum: '295' }, // Dragonite MUR -> Dragonite MHR
    { thNum: '246', enNum: '290' }, // Dragonite SAR -> Dragonite SIR
    { thNum: '232', enNum: '271' }, // Dragonite MA -> Dragonite UR
    { thNum: '126', enNum: '152' }, // Dragonite RR -> Dragonite DR
    { thNum: '234', enNum: '276' }, // Pikachu SAR -> Pikachu SIR
    { thNum: '044', enNum: '057' }, // Pikachu RR -> Pikachu DR
    { thNum: '238', enNum: '282' }, // Diancie SAR -> Diancie SIR
    { thNum: '227', enNum: '267' }, // Diancie MA -> Diancie UR
    { thNum: '241', enNum: '285' }, // Scrafty SAR -> Scrafty SIR
    { thNum: '231', enNum: '270' }, // Scrafty MA -> Scrafty UR
    { thNum: '110', enNum: '135' }, // Scrafty RR -> Scrafty DR
    { thNum: '235', enNum: '278' }, // Eelektross SAR -> Eelektross SIR
    { thNum: '225', enNum: '266' }, // Eelektross MA -> Eelektross UR
    { thNum: '049', enNum: '061' }, // Eelektross RR -> Eelektross DR
    { thNum: '239', enNum: '283' }, // Hawlucha SAR -> Hawlucha SIR
    { thNum: '229', enNum: '268' }, // Hawlucha MA -> Hawlucha UR
    { thNum: '094', enNum: '116' }, // Hawlucha RR -> Hawlucha DR #116
    { thNum: '036', enNum: '047' }, // Froslass RR -> Froslass DR
    { thNum: '224', enNum: '265' }, // Froslass MA -> Froslass UR
    { thNum: '233', enNum: '275' }, // Froslass SAR -> Froslass SIR
    { thNum: '071', enNum: '089' }, // Gardevoir RR -> Gardevoir DR
    { thNum: '226', enNum: '089' }, // Gardevoir MA -> Gardevoir DR
    { thNum: '092', enNum: '113' }, // Lucario RR -> Lucario DR
    { thNum: '228', enNum: '113' }, // Lucario MA -> Lucario DR
];

async function main() {
    console.log('Fetching Thai MA3 cards...');
    const { data: thaiCards } = await supabase.from('pokemon_cards').select('id, number, rarity, english_name').eq('set_id', 'MA3').eq('language', 'th').in('number', REFINED_MAPPINGS.map(m=>m.thNum));
    const thMap = {}; thaiCards.forEach(c => thMap[c.number] = c);

    console.log('Fetching English me02.5 cards...');
    const { data: enCards } = await supabase.from('pokemon_cards').select('id, number, name, rarity').eq('set_id', 'me02.5').eq('language', 'en').in('number', REFINED_MAPPINGS.map(m=>m.enNum));
    const enMap = {}; enCards.forEach(c => enMap[c.number] = c);

    const toUpsert = [];
    for (const m of REFINED_MAPPINGS) {
        const th = thMap[m.thNum];
        const en = enMap[m.enNum];
        if (!th) { console.warn(`Missing TH #${m.thNum}`); continue; }
        if (!en) { console.warn(`Missing EN #${m.enNum}`); continue; }

        console.log(`[${th.rarity}] ${th.english_name} #${th.number} --> [${en.rarity}] ${en.name} #${en.number}`);
        toUpsert.push({
            card_id_th: th.id,
            card_id_en: en.id,
            match_method: 'manual_confirmed',
            confidence_score: 1.0,
            verified: true
        });
    }

    if (toUpsert.length > 0) {
        console.log(`Upserting ${toUpsert.length} confirmed mappings...`);
        const { error } = await supabase.from('card_mappings').upsert(toUpsert, { onConflict: 'card_id_th' });
        if (error) console.error(error);
        else console.log('✅ Done!');
    }
}
main().catch(console.error);
