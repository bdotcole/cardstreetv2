const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const KEY = env['JUSTTCG_API_KEY'];

async function searchSet(name) {
    const url = `https://api.justtcg.com/v1/sets?game=pokemon&q=${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: { 'x-api-key': KEY } });
    const json = await r.json();
    return json;
}

async function main() {
    console.log('API Key:', KEY ? KEY.substring(0, 10) + '...' : 'MISSING');

    for (const name of ['Black Bolt', 'White Flare', 'Journey Together', 'Destined Rivals']) {
        console.log(`\n--- Searching for: ${name} ---`);
        try {
            const data = await searchSet(name);
            console.log(JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Error:', e.message);
        }
    }
}

main();
