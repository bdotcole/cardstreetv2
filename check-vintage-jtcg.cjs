const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const apiKeyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);
const JUSTTCG_API_KEY = apiKeyMatch[1].trim();

async function checkJustTcg() {
    console.log("Key length:", JUSTTCG_API_KEY.length);

    // We will search by card name (to see if that works) or set
    const candidates = [
        'gym-challenge-pokemon',
        'gym-heroes-pokemon',
        'skyridge-pokemon',
        'southern-islands-pokemon',
        'legendary-collection-pokemon',
        'expedition-base-set-pokemon',
        'aquapolis-pokemon',
        'base-set-pokemon',
        'sv-shrouded-fable-pokemon'
    ];

    for (const c of candidates) {
        const url = `https://api.justtcg.com/v1/cards?game=pokemon&set=${c}&limit=1`;
        const res = await fetch(url, {
            headers: { 'x-api-key': JUSTTCG_API_KEY, 'Content-Type': 'application/json' }
        });

        if (res.status === 200) {
            const data = await res.json();
            console.log(`✅ ${c} -> Found ${data.meta?.totalCount || data.data?.length} cards`);
        } else {
            console.log(`❌ ${c} -> Error ${res.status}`);
        }
    }
}

checkJustTcg().catch(console.error);
