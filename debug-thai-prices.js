const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const roleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = roleMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkThaiPrices() {
    // Let's find English "Ho-Oh" from sv10
    const { data: enCards } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, number, rarity')
        .eq('language', 'en')
        .ilike('name', '%Ho-Oh%');

    if (!enCards || enCards.length === 0) {
        console.log("No EN Ho-Oh cards found");
        return;
    }

    const enIds = enCards.map(c => c.id);

    // Find mappings
    const { data: mappings } = await supabase
        .from('card_mappings')
        .select('*')
        .in('card_id_en', enIds);

    const thIds = mappings.map(m => m.card_id_th);

    if (thIds.length === 0) {
        console.log("No Thai mappings found for EN Ho-Oh cards");
        return;
    }

    const { data: thCards } = await supabase
        .from('pokemon_cards')
        .select(`
            id, name, english_name, set_id, number, rarity,
            market_values!card_id (
                market_avg, currency, source_prices, last_updated
            )
        `)
        .in('id', thIds);

    for (const tCard of thCards) {
        console.log(`\nTHAI CARD: ${tCard.name} [aka ${tCard.english_name}] (${tCard.rarity}) [${tCard.id}]`);
        console.log(`Thai Price: ${tCard.market_values?.[0]?.market_avg} ${tCard.market_values?.[0]?.currency} (${tCard.market_values?.[0]?.last_updated})`);

        const mapEntry = mappings.find(m => m.card_id_th === tCard.id);
        const enId = mapEntry?.card_id_en;
        if (enId) {
            console.log(`Mapped to EN ID: ${enId}`);
            const { data: enCard } = await supabase
                .from('pokemon_cards')
                .select(`
                    id, name, number, rarity,
                    market_values!card_id (
                        market_avg, currency, last_updated
                    )
                `)
                .eq('id', enId)
                .single();

            if (enCard) {
                console.log(`EN CARD: ${enCard.name} #${enCard.number} (${enCard.rarity}) [${enCard.id}]`);
                console.log(`EN DB Price: ${enCard.market_values?.[0]?.market_avg} ${enCard.market_values?.[0]?.currency} (${enCard.market_values?.[0]?.last_updated})`);
            }
        }
    }
}

checkThaiPrices();
