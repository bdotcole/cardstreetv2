const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const apiKeyMatch = envContent.match(/JUSTTCG_API_KEY=(.+)/);
const JUSTTCG_API_KEY = apiKeyMatch[1].trim();

// Try different slug variants for Expedition
const candidates = [
    'expedition-base-set-pokemon',
    'expedition-pokemon',
    'ex01-expedition-pokemon',
    'e-expedition-pokemon',
    'expedition-base-pokemon',
];

async function test() {
    for (const c of candidates) {
        const url = `https://api.justtcg.com/v1/cards?game=pokemon&set=${c}&limit=1`;
        const res = await fetch(url, {
            headers: { 'x-api-key': JUSTTCG_API_KEY, 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const d = await res.json();
            console.log(`✅ ${c} -> ${d.meta?.totalCount || d.data?.length} cards`);
        } else {
            console.log(`❌ ${c} -> ${res.status}`);
        }
    }
}

test().catch(console.error);
