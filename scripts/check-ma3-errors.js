const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname,'..', '.env.local'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g,'');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const targets = ['Charizard ex', 'Gengar ex', 'Dragonite ex', 'Pikachu ex'];

    const { data: thCards } = await supabase.from('pokemon_cards')
        .select('id, name, english_name, rarity, number')
        .eq('set_id', 'MA3')
        .eq('language', 'th')
        .in('english_name', targets);

    for (const th of thCards || []) {
        const { data: mappings } = await supabase.from('card_mappings')
            .select('card_id_en, match_method')
            .eq('card_id_th', th.id);

        if (!mappings?.length) {
            console.log(`❌ UNMAPPED: [${th.rarity}] ${th.english_name} (#${th.number})`);
            continue;
        }

        const { data: enCard } = await supabase.from('pokemon_cards')
            .select('name, rarity, number, set_id')
            .eq('id', mappings[0].card_id_en)
            .single();

        console.log(`✅ MAPPED: [${th.rarity}] ${th.english_name} (#${th.number})`);
        console.log(`       -> ${enCard?.name} [${enCard?.rarity}] in ${enCard?.set_id} by ${mappings[0].match_method}`);
    }
}
main().catch(console.error);
