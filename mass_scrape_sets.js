const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGET_SETS = [
    'S12a', // including secret rares this time
    'S11a', 'S11', 'S10b', 'S10a', 'S10P', 'S10D', 'S9a', 'S9', 
    'S8b', 'S8a', 'S8', 'S7D', 'S7R', 'S6a', 'S6h', 's6k', 
    'S5a', 'S5I', 'S5R', 'SC3a', 'SC3b', 'SC1a', 'SC1b'
];

async function run() {
    console.log("Starting Mass Scrape...");
    
    // 1. Parse CSV mapping
    const csvLines = fs.readFileSync('lib/thai database/Thai Set Tracker - Main (1).csv', 'utf8').split('\n').filter(Boolean);
    const setMetaMap = {};
    const setsToInsert = [];
    
    for(let i=1; i<csvLines.length; i++) {
        let line = csvLines[i].replace(/\r/g, '');
        // quick parse respecting quotes -- simple approach since there's not too much complexity
        // format: id,name,english name,English Set Equilalent,printed_total,total,release_date,logo_url
        let cols = [];
        let cur = '';
        let inQuote = false;
        for(let c=0; c<line.length; c++) {
            if(line[c] === '"') { inQuote = !inQuote; }
            else if(line[c] === ',' && !inQuote) { cols.push(cur); cur = ''; }
            else { cur += line[c]; }
        }
        cols.push(cur);
        
        let id = cols[0];
        if (TARGET_SETS.includes(id) || TARGET_SETS.includes(id.toLowerCase()) || TARGET_SETS.includes(id.toUpperCase())) {
            setMetaMap[id] = {
                id: id,
                name: cols[1], // Thai name
                printed_total: parseInt(cols[4]),
                total: parseInt(cols[5]),
                releaseDate: new Date(cols[6]).toISOString().split('T')[0]
            };
            
            setsToInsert.push({
                id: id,
                name: cols[1],
                release_date: setMetaMap[id].releaseDate
            });
        }
    }
    
    console.log("Upserting Sets into pokemon_sets...");
    if (setsToInsert.length > 0) {
        let { error: tsErr } = await supabase.from('pokemon_sets').upsert(setsToInsert, { onConflict: 'id' });
        if (tsErr) console.error("Error inserting sets:", tsErr);
    }
    
    // Process each set
    for(let setId of TARGET_SETS) {
        const meta = setMetaMap[setId] || setMetaMap[setId.toUpperCase()] || setMetaMap[setId.toLowerCase()];
        if (!meta) {
            console.log("No metadata found for", setId, "skipping...");
            continue;
        }
        
        console.log(`\n============================\nProcessing Set ${setId}: ${meta.name}.....`);
        
        // Fetch JA reference db
        let { data: jaCards } = await supabase.from('pokemon_cards').select('*').eq('set_id', setId).eq('language', 'ja');
        if (!jaCards || jaCards.length === 0) {
            // Check uppercase
            const resp = await supabase.from('pokemon_cards').select('*').eq('set_id', setId.toUpperCase()).eq('language', 'ja');
            jaCards = resp.data || [];
        }
        
        let jaMap = {};
        jaCards.forEach(c => jaMap[c.number] = c);
        
        // Figure out how many pages (20 cards per page)
        let maxPages = Math.ceil((meta.total || meta.printed_total || 250) / 20) + 1;
        let setCards = [];
        let finalUpserts = [];
        
        // 1. Scrape standard cards
        const baseListUrl = `https://asia.pokemon-card.com/th/card-search/list/?expansionCodes=${setId}&pageNo=`;
        let standardCardUrls = [];
        
        for(let pg=1; pg<=maxPages; pg++) {
            try {
                let res = await fetch(baseListUrl + pg);
                let html = await res.text();
                const matchedLi = [...html.matchAll(/<li class="card">([\s\S]*?)<\/li>/g)];
                if (matchedLi.length === 0) break; // no more pages
                
                matchedLi.forEach(m => {
                    let block = m[1];
                    let hrefMatch = block.match(/href="([^"]+)"/);
                    let imgMatch = block.match(/data-original="([^"]+)"/);
                    if (hrefMatch) {
                        standardCardUrls.push({
                            url: 'https://asia.pokemon-card.com' + hrefMatch[1],
                            img: imgMatch ? imgMatch[1] : null
                        });
                    }
                });
            } catch (e) {
                console.error(`Error on page ${pg}:`, e.message);
            }
        }
        
        // eliminate dupes
        let seenUrls = new Set();
        standardCardUrls = standardCardUrls.filter(u => {
            if (seenUrls.has(u.url)) return false;
            seenUrls.add(u.url);
            return true;
        });
        
        console.log(`Found ${standardCardUrls.length} list items for ${setId}. Processing details...`);
        
        let scrapedNumbers = new Set();
        
        // Batch fetch details
        let batchSize = 15;
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
                        let number = rawNum.split('/')[0];
                        
                        let ref = jaMap[number];
                        let engName = ref ? ref.english_name : null;
                        let rarity = ref ? ref.rarity : null;
                        
                        scrapedNumbers.add(number);
                        
                        let image = item.img ? item.img : (ref ? ref.image_small : null);
                        
                        finalUpserts.push({
                            id: `${setId}-${number}-TH`,
                            set_id: setId,
                            language: 'th',
                            number: number,
                            name: thaiName,
                            english_name: engName,
                            rarity: rarity,
                            image_small: image,
                            image_large: ref ? ref.image_large : null
                        });
                    }
                } catch(err) {
                    console.error("Failed standard fetch:", item.url, err.message);
                }
            }));
        }
        
        // 2. Clone Secret Rares or missing JA cards
        let cloneCount = 0;
        for(let key of Object.keys(jaMap)) {
            let num = jaMap[key].number;
            if (!scrapedNumbers.has(num)) {
                // Not found on Thai site, clone directly from JA DB
                finalUpserts.push({
                    id: `${setId}-${num}-TH`,
                    set_id: setId,
                    language: 'th',
                    number: num,
                    name: jaMap[key].name, // Use JA name as placeholder
                    english_name: jaMap[key].english_name,
                    rarity: jaMap[key].rarity,
                    image_small: jaMap[key].image_small,
                    image_large: jaMap[key].image_large
                });
                cloneCount++;
            }
        }
        
        console.log(`Scraped ${scrapedNumbers.size} cards. Cloned ${cloneCount} missing/secret rares.`);
        
        // Upsert 
        if (finalUpserts.length > 0) {
            for(let k=0; k<finalUpserts.length; k+=100) {
                let { error: uErr } = await supabase.from('pokemon_cards').upsert(finalUpserts.slice(k, k+100));
                if (uErr) console.error(`Error upserting ${setId}:`, uErr.message);
            }
            console.log(`==== Success: Uploaded ${finalUpserts.length} total TH cards for ${setId}! ====`);
        }
    }
    
    console.log("All sets processed successfully!");
}

run();
