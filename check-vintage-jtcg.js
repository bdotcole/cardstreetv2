import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkJustTcg() {
    const apiKey = process.env.JUSTTCG_API_KEY;

    const candidates = [
        'gym-challenge-pokemon',
        'gym-heroes-pokemon',
        'skyridge-pokemon',
        'southern-islands-pokemon',
        'legendary-collection-pokemon',
        'expedition-base-set-pokemon',
        'aquapolis-pokemon',
        'base-set-pokemon',            // Let's test standard base set too for sanity
        'sv-shrouded-fable-pokemon'    // Baseline control
    ];

    for (const c of candidates) {
        const res = await fetch(`https://api.justtcg.com/v1/cards?game=pokemon&set=${c}&limit=1`, {
            headers: { 'X-Api-Key': apiKey }
        });

        if (res.status === 200) {
            const data = await res.json();
            console.log(`✅ ${c} -> Found ${data.meta?.totalCount || data.data.length} cards`);
        } else {
            console.log(`❌ ${c} -> Error ${res.status}`);
        }
    }
}

checkJustTcg().catch(console.error);
