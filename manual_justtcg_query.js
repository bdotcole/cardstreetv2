
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const keyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);

if (!keyMatch) {
    console.error('Could not parse .env.local for JustTCG key');
    process.exit(1);
}

const API_KEY = keyMatch[1].trim();

async function checkPrice(cardName) {
    console.log(`Checking price for: "${cardName}"`);
    const url = `https://api.justtcg.com/v1/cards/search?q=${encodeURIComponent(cardName)}&game=pokemon&language=en`;

    try {
        const response = await fetch(url, {
            headers: {
                'x-api-key': API_KEY,
                'User-Agent': 'CardStreet/1.0'
            }
        });

        if (!response.ok) {
            console.error(`API Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.log('Response body:', text);
            return;
        }

        const data = await response.json();
        if (data.data) {
            console.log(`Found ${data.data.length} results for ${cardName}`);
            data.data.forEach(c => {
                console.log(`- ${c.name} (${c.set.name}) ID: ${c.id} TCGID: ${c.tcgplayerSkuId || 'N/A'}`);
            });

            if (data.data.length > 0) {
                // Check variants for the first card
                const card = data.data[0];
                const nmVariants = card.variants?.filter(v =>
                    v.condition === 'Near Mint' || v.condition === 'NM' || v.condition === 'Mint'
                );

                console.log('NM Variants:', nmVariants);
            }
        } else {
            console.log('No results found.');
        }

    } catch (e) {
        console.error('Fetch error:', e);
    }
}

// Check problematic cards with me01 simulation
async function checkPriceSimulated(cardName, targetSet, cardNumber) {
    const justTcgApiKey = process.env.JUSTTCG_API_KEY || 'tcg_0b676c7d68074ec2ba032430a5868f9a';
    console.log('Using API Key:', justTcgApiKey);

    console.log(`Checking price for: "${cardName}" (Set: ${targetSet}, Number: ${cardNumber})`);
    try {
        const url = `https://api.justtcg.com/v1/cards/search?q=${encodeURIComponent(cardName)}&game=pokemon&language=en`;
        const response = await fetch(url, { headers: { 'x-api-key': justTcgApiKey } });
        console.log('Response Status:', response.status);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            let candidates = data.data;

            // 1. Filter by Set ID
            if (targetSet) {
                const setMatches = candidates.filter(c =>
                    c.id.includes(`-${targetSet.toLowerCase()}-`) ||
                    c.id.includes(`pokemon-${targetSet.toLowerCase()}-`)
                );
                if (setMatches.length > 0) {
                    candidates = setMatches;
                    console.log(`[Filtered by Set ${targetSet}]: Found ${candidates.length} candidates.`);
                } else {
                    console.log(`[Filtered by Set ${targetSet}]: Found 0 candidates.`);
                }
            }

            // 2. Filter by Card Number
            if (cardNumber) {
                const num = cardNumber.replace(/^0+/, '');
                const matches = candidates.filter(c => {
                    if (c.id.includes(`-${cardNumber}-`) || c.id.includes(`-${num}-`)) return true;
                    if (c.name.includes(` ${cardNumber}`) || c.name.includes(` ${num}/`)) return true;
                    return false;
                });
                if (matches.length > 0) {
                    candidates = matches;
                    console.log(`[Filtered by Number ${cardNumber}]: Found ${candidates.length} candidates.`);
                } else {
                    console.log(`[Filtered by Number ${cardNumber}]: Found 0 candidates.`);
                }
            }

            console.log('Final Candidates:', candidates.map(c => `${c.name} (${c.id})`));

            // Exact match logic
            const exactMatch = candidates.find(c => c.name.toLowerCase() === cardName.toLowerCase());
            const card = exactMatch || candidates[0];

            // Price avg
            const nmVariants = card.variants?.filter(v =>
                v.condition === 'Near Mint' || v.condition === 'NM' || v.condition === 'Mint'
            );
            const validVariants = (nmVariants?.length > 0) ? nmVariants : card.variants;
            const prices = validVariants?.map(v => v.price).filter(p => typeof p === 'number' && p > 0) || [];

            if (prices.length > 0) {
                const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
                console.log(`Calculated Price: ${avg} USD`);
            } else {
                console.log('No valid prices found.');
            }

        } else {
            console.log('No results found.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}



console.log('--- Simulating Loose Matching (No Number) ---');
checkPriceSimulated('Bulbasaur', 'me01', undefined);
checkPriceSimulated('Ivysaur', 'me01', undefined);
checkPriceSimulated('Mega Venusaur ex', 'me01', undefined);


