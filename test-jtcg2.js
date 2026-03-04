const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const apiKeyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);
const apiKey = apiKeyMatch[1].trim();

async function testSet(setId) {
    const url = `https://api.justtcg.com/v1/cards?game=pokemon&set=${setId}&conditions=NM&limit=100`;
    console.log("Fetching: " + url);
    const req = await fetch(url, { headers: { 'x-api-key': apiKey } });
    const res = await req.json();
    const single = res.data.find(c => c.number && c.number !== 'N/A');
    if (single) {
        console.log(`Found Single: ${single.name} (#${single.number})`);
        console.log(`Variants:`, JSON.stringify(single.variants, null, 2));
    } else {
        console.log("No singles found in first 100 results!");
    }
}

testSet('swsh03-darkness-ablaze-pokemon');
