const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGET_SETS = [
    'S12a', 'S11a', 'S11', 'S10b', 'S10a', 'S10P', 'S10D', 'S9a', 'S9', 
    'S8b', 'S8a', 'S8', 'S7D', 'S7R', 'S6a', 'S6h', 's6k', 
    'S5a', 'S5I', 'S5R', 'SC3a', 'SC3b', 'SC1a', 'SC1b'
];

async function fix() {
    console.log("Fixing Image URLs and Names across Sets...");
    
    let jpKanjihiraganaRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
    
    for (let setId of TARGET_SETS) {
        let toUpdate = [];
        let missingInserts = [];
        
        let jRes, jaData;
        try {
            jRes = await fetch(`https://api.tcgdex.net/v2/ja/sets/${setId.toLowerCase()}`);
            if (jRes.ok) jaData = await jRes.json();
        } catch(e) { }
        
        // Let's grab JA mapping from our own Supabase DB
        let dbJaMap = {};
        const { data: fullJaDB } = await supabase.from('pokemon_cards').select('*').eq('set_id', setId).eq('language', 'ja');
        if (fullJaDB) fullJaDB.forEach(c => dbJaMap[c.number] = c);
        
        // 1. Fetch current TH cards in DB for this specific Set (no 1000 limit issue across whole DB)
        const { data: imgCards } = await supabase.from('pokemon_cards').select('id, number, image_small, image_large, name, english_name').eq('set_id', setId).eq('language', 'th');
        let dbNums = new Set((imgCards || []).map(c => c.number.toString()));
        
        if (imgCards) {
            for (let c of imgCards) {
                let needsUpdate = false;
                let imgSmall = c.image_small;
                let imgLarge = c.image_large;
                let nName = c.name;
                
                // Fix images
                if (imgSmall && imgSmall.includes('tcgdex.net') && !imgSmall.includes('.png')) {
                    imgSmall += '.png';
                    needsUpdate = true;
                }
                if (imgLarge && imgLarge.includes('tcgdex.net') && !imgLarge.includes('.png')) {
                    imgLarge += '.png';
                    needsUpdate = true;
                }
                
                // Fix Japanese names populated during initial clone
                if (jpKanjihiraganaRegex.test(nName)) {
                    // It's Japanese! Swap with english_name if available, else look up from dbJaMap
                    let newEng = c.english_name || (dbJaMap[c.number] ? dbJaMap[c.number].english_name : null);
                    if (newEng) {
                        nName = newEng;
                    }
                    needsUpdate = true; // force update to clear it or update it
                }
                
                if (needsUpdate) {
                    toUpdate.push({
                        id: c.id,
                        image_small: imgSmall,
                        image_large: imgLarge,
                        name: nName
                    });
                }
            }
        }
        
        if (toUpdate.length > 0) {
            console.log(`Updating ${toUpdate.length} existing TH cards for ${setId}...`);
            for(let i=0; i<toUpdate.length; i+=100) {
                await supabase.from('pokemon_cards').upsert(toUpdate.slice(i, i+100));
            }
        }
        
        // 2. Fetch missing Secret Rares from TCGdex and insert them directly 
        if (jaData && jaData.cards) {
            for (let jpc of jaData.cards) {
                let numStr = jpc.localId;
                if (!dbNums.has(numStr)) {
                    let ref = dbJaMap[numStr];
                    let engName = ref ? ref.english_name : null;
                    let rarity = ref ? ref.rarity : 'Rare';
                    let imgBase = jpc.image; // https://assets.tcgdex.net/ja/S/S12a/001
                    
                    let defaultName = engName || (ref ? ref.name : jpc.name);
                    
                    missingInserts.push({
                        id: `${setId}-${numStr}-TH`,
                        set_id: setId,
                        language: 'th',
                        number: numStr,
                        name: defaultName,
                        english_name: engName,
                        rarity: rarity,
                        image_small: imgBase ? imgBase + '/low.png' : (ref ? ref.image_small : null),
                        image_large: imgBase ? imgBase + '/high.png' : (ref ? ref.image_large : null),
                    });
                }
            }
        }
        
        if (missingInserts.length > 0) {
            console.log(`Inserting ${missingInserts.length} completely missing SRs / cards for ${setId}...`);
            for(let i=0; i<missingInserts.length; i+=100) {
                await supabase.from('pokemon_cards').upsert(missingInserts.slice(i, i+100));
            }
        }
    }
    
    console.log("Fix completed successfully!");
}

fix();
