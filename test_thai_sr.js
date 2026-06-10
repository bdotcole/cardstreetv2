const fetch = require('node-fetch');

async function testThaiSR() {
    try {
        let res = await fetch('https://asia.pokemon-card.com/th/card-search/list/?expansionCodes=S8b&limit=200&rarities=SR,SAR,UR,HR,AR,SSR,CHR,CSR,K');
        let html = await res.text();
        const matchedLi = html.split('<li class="card">');
        console.log(`Found ${matchedLi.length - 1} secret rares on official Thai site for S8b!!`);
        
        if (matchedLi.length > 1) {
            let m = matchedLi[1];
            let hrefMatch = m.match(/href="([^"]+)"/);
            let imgMatch = m.match(/data-original="([^"]+)"/);
            console.log("Sample Match:", { url: hrefMatch ? hrefMatch[1] : null, img: imgMatch ? imgMatch[1] : null });
        }
    } catch(e) {
        console.error(e);
    }
}
testThaiSR();
