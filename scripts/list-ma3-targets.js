const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname,'..', '.env.local'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g,'');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const targets = ['Charizard', 'Gengar', 'Dragonite', 'Pikachu', 'Lucario', 'Diancie', 'Scrafty', 'Eelektross', 'Hawlucha', 'Froslass', 'Gardevoir'];

    for (const t of targets) {
        const { data: thCards } = await supabase.from('pokemon_cards')
            .select('id, name, english_name, rarity, number')
            .eq('set_id', 'MA3')
            .eq('language', 'th')
            .ilike('english_name', `%${t}%`)
            .order('number');

        console.log(`\n=== Thai ${t} in MA3 ===`);
        for (const c of thCards || []) {
            console.log(`  [${c.rarity}] #${c.number} ${c.english_name}`);
        }
    }
}
main().catch(console.error);
