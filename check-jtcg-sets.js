import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkJustTcg() {
    const apiKey = process.env.JUSTTCG_API_KEY;
    console.log("Using API Key:", apiKey ? "***" : "MISSING");

    const res = await fetch('https://api.justtcg.com/v1/cards?game=pokemon&set=sv-shrouded-fable-pokemon&limit=1', {
        headers: { 'X-Api-Key': apiKey }
    });
    console.log("sv-shrouded-fable-pokemon ->", res.status, res.status === 200 ? (await res.json()).data.length : '');

    const res2 = await fetch('https://api.justtcg.com/v1/cards?game=pokemon&set=sv06.5-shrouded-fable-pokemon&limit=1', {
        headers: { 'X-Api-Key': apiKey }
    });
    console.log("sv06.5-shrouded-fable-pokemon ->", res2.status, res2.status === 200 ? (await res.json()).data.length : '');
}

checkJustTcg();
