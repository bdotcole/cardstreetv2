const fs = require('fs');
const path = require('path');
const https = require('https');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const apiKeyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);
const apiKey = apiKeyMatch[1].trim();

async function fetchAllSets() {
    let allSets = [];
    let offset = 0;
    while (true) {
        const url = `https://api.justtcg.com/v1/sets?game=pokemon&limit=100&offset=${offset}`;
        console.log("Fetching: " + url);
        const req = await fetch(url, { headers: { 'x-api-key': apiKey } });
        const res = await req.json();
        allSets = allSets.concat(res.data.map(s => ({ id: s.id, name: s.name })));
        if (!res.meta.hasMore) break;
        offset += 100;
    }
    fs.writeFileSync('jtcg-sets.json', JSON.stringify(allSets, null, 2));
    console.log(`Saved ${allSets.length} sets to jtcg-sets.json`);
}

fetchAllSets();
