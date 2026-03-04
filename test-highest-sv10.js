const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const roleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = roleMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHighPrices() {
    const { data: cards } = await supabase
        .from('pokemon_cards')
        .select(`
            id, name, number, rarity,
            market_values!card_id (
                market_avg
            )
        `)
        .eq('set_id', 'sv10')
        .eq('language', 'en');

    let pricedCards = cards
        .map(c => ({
            id: c.id,
            name: c.name,
            number: c.number,
            rarity: c.rarity,
            price: Math.max(0, ...(c.market_values?.map(m => m.market_avg) || []))
        }))
        .filter(c => c.price > 0)
        .sort((a, b) => b.price - a.price);

    console.log("Top 10 highest priced cards in SV10 (English):");
    for (let i = 0; i < 10 && i < pricedCards.length; i++) {
        console.log(`${i + 1}. [${pricedCards[i].id}] ${pricedCards[i].name} #${pricedCards[i].number} (${pricedCards[i].rarity}) - $${pricedCards[i].price}`);
    }
}

checkHighPrices();
