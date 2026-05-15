import fetch from 'node-fetch';
import process from 'process';

async function findJustTcgSets() {
    const apiKey = 'tcg_321c4596652b46d19de533a7518912ca';

    const res = await fetch(`https://api.justtcg.com/v1/sets?game=pokemon`, {
        headers: { 'x-api-key': apiKey }
    });

    if (res.status === 200) {
        const data = await res.json();
        const sets = data.data || [];

        console.log(`Found ${sets.length} total sets.`);

        const searchTerms = [
            'Gym Challenge', 'Gym Heroes', 'Skyridge', 'Southern Islands',
            'Legendary Collection', 'Expedition', 'Aquapolis'
        ];

        for (const term of searchTerms) {
            const matches = sets.filter(s => s.name.toLowerCase().includes(term.toLowerCase()));
            console.log(`\nMatches for ${term}:`);
            matches.forEach(m => console.log(` - ${m.name}: ${m.id}`));
        }
    } else {
        console.log(`Error ${res.status}:`, await res.text());
    }
}

findJustTcgSets().catch(console.error);
