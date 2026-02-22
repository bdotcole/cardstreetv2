
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
// const fetch = require('node-fetch'); // Use native fetch

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const justTcgApiKey = process.env.JUSTTCG_API_KEY || 'tcg_0b676c7d68074ec2ba032430a5868f9a';

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchJustTCGPrice(cardName, targetSet, cardNumber) {
    const url = `https://api.justtcg.com/v1/cards/search?q=${encodeURIComponent(cardName)}&game=pokemon&language=en`;
    try {
        const response = await fetch(url, {
            headers: {
                'x-api-key': 'tcg_0b676c7d68074ec2ba032430a5868f9a',
            },
        });

        if (!response.ok) {
            console.error(`API Error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        if (data.data && data.data.length > 0) {
            let candidates = data.data;

            // 1. Filter by Set ID
            if (targetSet) {
                const setMatches = candidates.filter(c =>
                    c.id.includes(`-${targetSet.toLowerCase()}-`) ||
                    c.id.includes(`pokemon-${targetSet.toLowerCase()}-`)
                );
                if (setMatches.length > 0) candidates = setMatches;
            }

            // 2. Filter by Card Number (Strict Logic)
            if (cardNumber) {
                const num = cardNumber.replace(/^0+/, '');
                const matches = candidates.filter(c => {
                    if (c.id.includes(`-${cardNumber}-`) || c.id.includes(`-${num}-`)) return true;
                    if (c.name.includes(` ${cardNumber}`) || c.name.includes(` ${num}/`)) return true;
                    return false;
                });
                if (matches.length > 0) candidates = matches;
            }

            // 3. Exact Match or First available
            const exactMatch = candidates.find(c => c.name.toLowerCase() === cardName.toLowerCase());
            const card = exactMatch || candidates[0];

            if (card && card.variants) {
                const nmVariants = card.variants.filter(v =>
                    ['Near Mint', 'NM', 'Mint'].includes(v.condition)
                );
                const validVariants = nmVariants.length > 0 ? nmVariants : card.variants;

                const prices = validVariants
                    .map(v => v.price)
                    .filter(p => typeof p === 'number' && p > 0);

                if (prices.length === 0) return null;
                const sum = prices.reduce((a, b) => a + b, 0);
                return sum / prices.length;
            }
        }
    } catch (error) {
        console.error('Fetch error:', error.message);
    }
    return null;
}

async function run() {
    console.log('Fetching me01 cards...');
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id, number')
        .eq('set_id', 'me01'); // Force me01 only

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    console.log(`Found ${cards.length} cards in me01.`);

    for (const card of cards) {
        // Skip if already has a RECENT price? No, we want to overwrite with correct logic.
        // But maybe check if price > 1000 (likely wrong) or something? 
        // Let's just re-price ALL me01 to be safe and fast (188 cards is fast).

        await new Promise(r => setTimeout(r, 500)); // Rate limit

        const usdPrice = await fetchJustTCGPrice(card.name, 'me01', card.number);

        let finalPrice = 10;
        let pricingMethod = 'default_floor';
        let rawCalc = 0;

        if (usdPrice) {
            rawCalc = usdPrice * 35.85; // THB
            finalPrice = Math.max(Math.round(rawCalc), 10);
            pricingMethod = 'en_direct_local_fix';
            console.log(`[${card.number}] ${card.name}: $${usdPrice.toFixed(2)} -> ${finalPrice} THB`);
        } else {
            console.log(`[${card.number}] ${card.name}: No match (Default 10)`);
        }

        const { error: upsertError } = await supabase.from('market_values').upsert({
            card_id: card.id,
            language: 'th',
            condition: 'Raw_NM',
            market_avg: finalPrice,
            source_links: ['JustTCG (Local Fix)'],
            source_prices: { raw_calculated: rawCalc, method: pricingMethod },
            currency: 'THB',
            last_updated: new Date().toISOString()
        }, { onConflict: 'card_id, language, condition' });

        if (upsertError) console.error(`Error updating ${card.id}:`, upsertError);
    }
    console.log('Finished fixing me01 prices locally.');
}

run();
