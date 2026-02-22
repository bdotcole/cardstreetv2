
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const anonKeyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

if (!anonKeyMatch || !urlMatch) {
    console.error('Could not parse .env.local');
    process.exit(1);
}

const supabase = createClient(urlMatch[1], anonKeyMatch[1]);

async function checkProgress() {
    const setIds = ['me01'];

    console.log(`--- Pricing Progress Monitor ---`);
    console.log(`Time: ${new Date().toLocaleTimeString()}`);

    for (const setId of setIds) {
        // Total count
        const { count: total } = await supabase
            .from('pokemon_cards')
            .select('*', { count: 'exact', head: true })
            .eq('set_id', setId);

        // Priced count
        // Get IDs first is safer/easier than join for simple count
        const { data: cards } = await supabase
            .from('pokemon_cards')
            .select('id')
            .eq('set_id', setId);

        if (!cards) continue;
        const cardIds = cards.map(c => c.id);

        const { count: priced } = await supabase
            .from('market_values')
            .select('*', { count: 'exact', head: true })
            .in('card_id', cardIds);

        const percentage = total > 0 ? ((priced / total) * 100).toFixed(1) : 0;

        console.log(`Set ${setId}: ${priced}/${total} (${percentage}%) priced.`);

        // Show unpriced sample
        if (priced < total) {
            const { data: pricedCards } = await supabase
                .from('market_values')
                .select('card_id')
                .in('card_id', cardIds);
            const pricedIds = new Set(pricedCards.map(p => p.card_id));

            const unpriced = cards.filter(c => !pricedIds.has(c.id)).slice(0, 3);
            console.log(`   Next waiting: ${unpriced.map(u => u.id).join(', ')}...`);
        } else {
            console.log(`   Complete!`);
        }
    }
}

checkProgress();
