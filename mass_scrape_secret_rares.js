const { createClient } = require('@supabase/supabase-js');

// Never hard-code the service-role key — read it from .env.local.
const _env = {};
for (const line of require('fs').readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    _env[k] = v;
}
const SUPABASE_URL = _env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = _env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGET_SETS = [
    'S12a', 'S11a', 'S11', 'S10b', 'S10a', 'S10P', 'S10D', 'S9a', 'S9', 
    'S8b', 'S8a', 'S8', 'S7D', 'S7R', 'S6a', 'S6h', 's6k', 
    'S5a', 'S5I', 'S5R', 'SC3a', 'SC3b', 'SC1a', 'SC1b'
];

async function run() {
    console.log("Starting pure native Thai Secret Rare Extractor...");
    for (let setId of TARGET_SETS) {
        let maxPages = 15; // Set higher just in case (SC3a has many)
        let standardCardUrls = [];
        const baseListUrl = `https://asia.pokemon-card.com/th/card-search/list/?expansionCodes=${setId}&rarities=SR,SAR,UR,HR,AR,SSR,CHR,CSR,K,A&pageNo=`;
        
        for (let pg=1; pg<=maxPages; pg++) {
            try {
                let res = await fetch(baseListUrl + pg);
                let html = await res.text();
                let matches = html.split('<li class="card">');
                if (matches.length <= 1) break; // no more cards
                
                for(let m=1; m<matches.length; m++) {
                    let block = matches[m];
                    let hrefMatch = block.match(/href="([^"]+)"/);
                    let imgMatch = block.match(/data-original="([^"]+)"/);
                    if (hrefMatch) {
                        standardCardUrls.push({
                            url: 'https://asia.pokemon-card.com' + hrefMatch[1],
                            img: imgMatch ? imgMatch[1] : null
                        });
                    }
                }
            } catch (e) {
                console.error("Page error:", e.message);
            }
        }
        
        if (standardCardUrls.length === 0) {
            console.log(`No Secret Rares found for ${setId} via filter.`);
            continue;
        }
        
        // Remove duplicates just in case
        let seenUrls = new Set();
        standardCardUrls = standardCardUrls.filter(u => {
            if (seenUrls.has(u.url)) return false;
            seenUrls.add(u.url);
            return true;
        });
        
        console.log(`Found ${standardCardUrls.length} SECRET RARES for ${setId}. Processing details...`);
        let finalUpserts = [];
        let batchSize = 10;
        
        for(let i=0; i<standardCardUrls.length; i+=batchSize) {
            let chunk = standardCardUrls.slice(i, i+batchSize);
            await Promise.all(chunk.map(async (item) => {
                try {
                    let dRes = await fetch(item.url);
                    let dHtml = await dRes.text();
                    
                    const titleMatch = dHtml.match(/<title>([^<]+)\|/);
                    const numMatch = dHtml.match(/<span class="collectorNumber">\s*([a-zA-Z0-9]+)\/[0-9]+\s*<\/span>/) || dHtml.match(/<span class="collectorNumber">\s*([^<]+)\s*<\/span>/);
                    
                    if (titleMatch && numMatch) {
                        let thaiName = titleMatch[1].replace(/ร่าง 1\s+/, '').replace(/ร่าง 2\s+/, '').replace(/พื้นฐาน\s+/, '').replace(/VMAX\s+/, '').replace(/VSTAR\s+/, '').trim();
                        let rawNum = numMatch[1].trim();
                        let number = rawNum.split('/')[0]; // Strip max number e.g., 255/172 -> 255
                        
                        // Parse Rarity if possible
                        let rarity = 'Rare'; // default
                        let rarMatch = dHtml.match(/<span class="rarity">\s*(SR|UR|HR|AR|SAR|SSR|CHR|CSR|A|K)\s*<\/span>/);
                        if (rarMatch) rarity = rarMatch[1];
                        
                        finalUpserts.push({
                            id: `${setId}-${number}-TH`,
                            set_id: setId,
                            language: 'th',
                            number: number,
                            name: thaiName,
                            rarity: rarity,
                            image_small: item.img,
                            image_large: item.img // standard Thai site provides scalable PNGs
                        });
                    }
                } catch(err) {}
            }));
        }
        
        if (finalUpserts.length > 0) {
            console.log(`==== Success: Overwriting/Uploading ${finalUpserts.length} pure Thai Secret Rares for ${setId}! ====`);
            await supabase.from('pokemon_cards').upsert(finalUpserts);
        }
    }
    console.log("Secret Rare mapping complete!");
}

run();
