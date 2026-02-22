
// require('dotenv').config({ path: '.env.local' });
// const fetch = require('node-fetch');

async function fetchJustTCGPrice(cardName, targetSet, cardNumber) {
    const url = `https://api.justtcg.com/v1/cards/search?q=${encodeURIComponent(cardName)}&game=pokemon&language=en`;
    console.log(`Searching: ${cardName} (Set: ${targetSet}, Num: ${cardNumber})`);

    try {
        const response = await fetch(url, {
            headers: {
                'x-api-key': process.env.JUSTTCG_API_KEY || 'tcg_321c4596652b46d19de533a7518912ca',
            },
        });

        if (!response.ok) {
            console.error(`Status: ${response.status}`);
            return;
        }

        const data = await response.json();
        let candidates = data.data || [];
        console.log(`Raw candidates: ${candidates.length}`);

        // 1. Filter by Set ID
        if (targetSet) {
            const setMatches = candidates.filter(c =>
                c.id.includes(`-${targetSet.toLowerCase()}-`) ||
                c.id.includes(`pokemon-${targetSet.toLowerCase()}-`)
            );
            console.log(`Filtered by set '${targetSet}': ${setMatches.length} matches`);
            if (setMatches.length > 0) candidates = setMatches;
        }

        // 2. Filter by Card Number
        if (cardNumber) {
            const num = cardNumber.replace(/^0+/, '');
            const matches = candidates.filter(c => {
                if (c.id.includes(`-${cardNumber}-`) || c.id.includes(`-${num}-`)) return true;
                if (c.name.includes(` ${cardNumber}`) || c.name.includes(` ${num}/`)) return true;
                return false;
            });
            console.log(`Filtered by number '${cardNumber}': ${matches.length} matches`);
            if (matches.length > 0) candidates = matches;
        }

        // Show top candidates
        console.log('--- Top Candidates ---');
        candidates.slice(0, 5).forEach(c => {
            console.log(`ID: ${c.id}`);
            console.log(`Name: ${c.name}`);
            if (c.variants) {
                const nm = c.variants.find(v => v.condition === 'Near Mint');
                console.log(`Price: $${nm ? nm.price : 'N/A'}`);
            }
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

// Check me02-011 Charmander
fetchJustTCGPrice('Charmander', 'me02', '011');
