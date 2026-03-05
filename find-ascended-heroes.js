import fetch from 'node-fetch';

async function findSet() {
    // Search TCGdex for the set
    const setsRes = await fetch('https://api.tcgdex.net/v2/en/sets');
    const sets = await setsRes.json();

    const matches = sets.filter(s =>
        s.name.toLowerCase().includes('ascended') ||
        s.name.toLowerCase().includes('ascend')
    );

    console.log("TCGdex matches for 'Ascended':");
    console.log(matches);

    if (matches.length === 0) {
        console.log("\nDidn't find it — all recent SV sets:");
        const recent = sets
            .filter(s => s.id && s.id.startsWith('sv'))
            .sort((a, b) => a.id.localeCompare(b.id));
        console.table(recent.map(s => ({ id: s.id, name: s.name })));
    }
}

findSet().catch(console.error);
