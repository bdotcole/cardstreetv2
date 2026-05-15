import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const envContent = fs.readFileSync('.env.local', 'utf8');
const apiKeyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);
const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : '';

async function findJustTcgSets() {
    console.log("Using API Key of length:", apiKey.length);

    // We will search by card name to discover the true JustTCG set IDs
    const searchQueries = [
        { set: 'Gym Challenge', query: "Blaine's Arcanine" },
        { set: 'Gym Heroes', query: "Erika's Vileplume" },
        { set: 'Skyridge', query: 'Ho-Oh', number: '149' }, // Crystal
        { set: 'Southern Islands', query: 'Mew', number: '1' },
        { set: 'Legendary Collection', query: 'Dark Blastoise' },
        { set: 'Expedition', query: 'Lugia' },
        { set: 'Aquapolis', query: 'Houndoom' }
    ];

    for (const sq of searchQueries) {
        let url = `https://api.justtcg.com/v1/cards?game=pokemon&name=${encodeURIComponent(sq.query)}&limit=10`;
        const res = await fetch(url, { headers: { 'x-api-key': apiKey } });

        if (res.status === 200) {
            const data = await res.json();
            const cards = data.data || [];

            console.log(`\n--- Looking for ${sq.set} using query '${sq.query}' ---`);
            const matchedCards = cards.filter(c =>
                (sq.number ? c.number === sq.number : true) &&
                c.set && c.set.name && c.set.name.toLowerCase().includes(sq.set.toLowerCase().replace(' base set', ''))
            );

            if (matchedCards.length > 0) {
                console.log(`✅ Found! JustTCG Set ID: ${matchedCards[0].set.id}`);
                console.log(`   Set Name: ${matchedCards[0].set.name}`);
            } else if (cards.length > 0) {
                console.log(`❌ Not found exactly. Top sets for this card:`);
                const uniqueSets = [...new Set(cards.map(c => `${c.set.name} (${c.set.id})`))];
                uniqueSets.forEach(s => console.log(`   - ${s}`));
            } else {
                console.log(`❌ No cards found for query.`);
            }
        } else {
            console.log(`Error ${res.status} for query '${sq.query}'`);
        }
    }
}

findJustTcgSets().catch(console.error);
