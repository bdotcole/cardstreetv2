import fetch from 'node-fetch';

async function verifySlugs() {
    const setsResponse = await fetch('https://api.tcgdex.net/v2/en/sets');
    const sets = await setsResponse.json();

    const searchTerms = [
        'Gym Challenge', 'Gym Heroes', 'Skyridge', 'Southern Islands',
        'Legendary Collection', 'Expedition', 'Aquapolis'
    ];

    for (const term of searchTerms) {
        const match = sets.find(s => s.name.toLowerCase().includes(term.toLowerCase()));
        if (match) {
            console.log(`\nFound TCGdex Set: ${match.name} (${match.id})`);

            // Fetch one card to see its TCGplayer URL slug
            const setRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${match.id}`);
            const setData = await setRes.json();

            if (setData.cards && setData.cards.length > 0) {
                const cardRes = await fetch(`https://api.tcgdex.net/v2/en/cards/${setData.cards[0].id}`);
                const cardData = await cardRes.json();
                console.log(` -> Example Card: ${cardData.name}`);
            }
        }
    }
}

verifySlugs().catch(console.error);
