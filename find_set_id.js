
// const fetch = require('node-fetch');

async function val() {

    // Search for Mega Heracross
    const url = `https://api.justtcg.com/v1/cards/search?q=Mega%20Heracross&game=pokemon&language=en`;
    try {
        const response = await fetch(url, { method: 'GET', headers: { 'x-api-key': 'tcg_321c4596652b46d19de533a7518912ca' } });
        const data = await response.json();

        // Print IDs
        console.log(data.data.map(c => c.id));

    } catch (e) {
        console.log(e);
    }
}
val();
