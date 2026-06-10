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
    console.log("Fixing Image URLs and Japanese Names...");
    
    // 1. Fix images missing .png extension
    const { data: imgCards, error: imgErr } = await supabase
        .from('pokemon_cards')
        .select('*')
        .eq('language', 'th')
        .like('image_small', '%tcgdex.net%');
        
    if (!imgErr && imgCards) {
        const toUpdate = imgCards.filter(c => !c.image_small.includes('.png'));
        console.log(`Found ${toUpdate.length} cards needing .png suffix.`);
        for(let i=0; i<toUpdate.length; i+=100) {
            let chunk = toUpdate.slice(i, i+100).map(c => ({
                id: c.id,
                image_small: c.image_small ? c.image_small + '.png' : c.image_small,
                image_large: c.image_large ? c.image_large + '.png' : c.image_large,
            }));
            await supabase.from('pokemon_cards').upsert(chunk);
        }
    }
    
    // 2. Fix Japanese names in Thai cards (Replace with English from TCGdex EN if possible)
    // We'll iterate through all TARGET_SETS and fetch from TCGDex directly to get missing SRs + English Names.
    
    for (let setId of TARGET_SETS) {
        console.log(`Checking missing/SRs for ${setId}...`);
        
        let jRes, eRes;
        try {
            jRes = await fetch(`https://api.tcgdex.net/v2/ja/sets/${setId.toLowerCase()}`);
            eRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${setId.toLowerCase()}`);
        } catch(e) { }
        
        let jaData = jRes && jRes.ok ? await jRes.json() : null;
        let enData = eRes && eRes.ok ? await eRes.json() : null; // Many basic sets won't work in EN API 1:1, but some do
        
        if (!jaData || !jaData.cards) {
            console.log(`Could not fetch TCGdex JA list for ${setId}, skipping...`);
            continue;
        }
        
        // Fetch current TH cards in DB
        let { data: currThCards } = await supabase.from('pokemon_cards').select('id, number, name').eq('set_id', setId).eq('language', 'th');
        let thMap = new Set((currThCards || []).map(c => c.number.toString()));
        let jpKanjihiraganaRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
        
        let updatesAndInserts = [];
        
        for (let jpc of jaData.cards) {
            let numStr = jpc.localId; // the card number
            let enc = enData?.cards?.find(ec => ec.localId === numStr);
            let enName = enc ? enc.name : null;
            
            // Try fetching detail if we really need english English Name & Rarity
            let rarity = null;
            let imgBase = jpc.image; // "https://assets.tcgdex.net/ja/S/S12a/001"
            
            if (thMap.has(numStr)) {
                // It exists. Check if we need to fix Japanese name.
                let dbCard = currThCards.find(c => c.number === numStr);
                if (dbCard && jpKanjihiraganaRegex.test(dbCard.name)) {
                    // It has a Japanese name. Replace with English!
                    if (!enName) enName = jpc.name; // fallback slightly, but we want to avoid JP if possible
                    // If enName is still Japanese (because enData failed), try requesting the individual card in English
                    if (jpKanjihiraganaRegex.test(enName)) {
                        try {
                            let cdRes = await fetch(`https://api.tcgdex.net/v2/en/cards/${setId.toLowerCase()}-${numStr}`);
                            if (cdRes.ok) { let cdData = await cdRes.json(); enName = cdData.name; rarity = cdData.rarity; }
                        } catch(e){}
                    }
                    
                    if (!jpKanjihiraganaRegex.test(enName)) {
                        updatesAndInserts.push({
                            id: `${setId}-${numStr}-TH`,
                            name: enName,
                            english_name: enName
                        });
                    }
                }
            } else {
                // It's a missing Secret Rare!
                // Let's get its rarity and English name
                try {
                    let cdRes = await fetch(`https://api.tcgdex.net/v2/en/cards/${setId.toLowerCase()}-${numStr}`);
                    if (cdRes.ok) { let cdData = await cdRes.json(); enName = cdData.name; rarity = cdData.rarity; }
                } catch(e){}
                
                if (!enName || jpKanjihiraganaRegex.test(enName)) {
                    // Attempt EN by global ID
                    enName = jpc.name; // fallback
                }
                
                updatesAndInserts.push({
                    id: `${setId}-${numStr}-TH`,
                    set_id: setId,
                    language: 'th',
                    number: numStr,
                    name: enName, // Place EN name in the TH column instead of JP
                    english_name: enName,
                    rarity: rarity || 'Rare', // Generic fallback
                    image_small: imgBase ? imgBase + '/low.png' : null,
                    image_large: imgBase ? imgBase + '/high.png' : null
                });
            }
        }
        
        if (updatesAndInserts.length > 0) {
            console.log(`Pushing ${updatesAndInserts.length} fixes/missing SRs for ${setId}...`);
            // Batch push
            for(let i=0; i<updatesAndInserts.length; i+=100) {
                let chunk = updatesAndInserts.slice(i, i+100);
                await supabase.from('pokemon_cards').upsert(chunk);
            }
        }
    }
    console.log("Fix completed successfully!");
}

fix();
