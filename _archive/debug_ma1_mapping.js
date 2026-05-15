
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
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

async function checkEnglishRarities() {
    console.log('--- Checking English Set `me01` Rarities ---');

    const testCards = [
        { name: 'Alakazam', thaiRarity: 'Art Rare' },
        { name: 'Mega Venusaur ex', thaiRarity: 'Secret Rare' },
        { name: 'Buddy-Buddy Poffin', thaiRarity: 'Secret Rare' },
        { name: 'Mega Charizard ex', thaiRarity: 'Secret Rare' } // Guessing this might exist
    ];

    for (const card of testCards) {
        console.log(`\nSearching for "${card.name}" (Thai: ${card.thaiRarity})...`);

        const { data: matches } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, rarity, number')
            .eq('language', 'en')
            .eq('set_id', 'me01')
            .ilike('name', `%${card.name}%`);

        if (matches && matches.length > 0) {
            matches.forEach(m => console.log(`  MATCH FOUND: [${m.id}] ${m.name} | Rarity: "${m.rarity}" | Num: ${m.number}`));
        } else {
            console.log('  No matches found in me01.');
        }
    }
}

checkEnglishRarities();
