
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function verifyLogic() {
    console.log('--- Verifying Edge Logic ---');
    const thaiSetsToMatch = ['MA1', 'MA2', 'SV10s', 'SV9s', 'SV11s'];

    // 1. Fetch Candidates
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, language')
        .in('set_id', thaiSetsToMatch)
        .eq('language', 'th')
        .limit(50);

    console.log(`Fetched ${cards?.length} cards.`);
    if (error) console.error(error);

    // 2. Check Pricing Status
    const unpriced = [];
    for (const card of cards || []) {
        const { data: existing } = await supabase
            .from('market_values')
            .select('id, last_updated')
            .eq('card_id', card.id)
            .gte('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle();

        if (!existing) {
            unpriced.push(card);
            console.log(`Found unpriced: ${card.name} (${card.id})`);
        } else {
            console.log(`Already priced: ${card.name} (${card.id}) - ${existing.last_updated}`);
        }
    }

    console.log(`Total Unpriced Candidates: ${unpriced.length}`);
}

verifyLogic();
