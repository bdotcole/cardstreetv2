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

async function fix() {
    console.log("Starting Perfect Sync & Fix...");
    let jpKanjihiraganaRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
    
    for (let setId of TARGET_SETS) {
        let updatesAndInserts = [];
        
        // 1. Fetch full JA database subset for this Set (this is where complete secret rares lie!)
        let { data: jaCards } = await supabase.from('pokemon_cards').select('*').eq('set_id', setId).eq('language', 'ja');
        if (!jaCards || jaCards.length === 0) {
            // Check uppercase fallbacks
            let res = await supabase.from('pokemon_cards').select('*').eq('set_id', setId.toUpperCase()).eq('language', 'ja');
            jaCards = res.data || [];
        }
        
        // 2. Fetch full TH database subset for this Set
        const { data: thCards } = await supabase.from('pokemon_cards').select('*').eq('set_id', setId).eq('language', 'th');
        let thMap = {};
        if (thCards) thCards.forEach(c => thMap[c.number.toString()] = c);
        
        for (let jpc of jaCards) {
            let numStr = jpc.number.toString();
            let thc = thMap[numStr];
            
            // Build the image URLs properly
            let imgSmall = jpc.image_small;
            let imgLarge = jpc.image_large;
            if (imgSmall && imgSmall.includes('tcgdex.net') && !imgSmall.includes('.png')) imgSmall += '.png';
            if (imgLarge && imgLarge.includes('tcgdex.net') && !imgLarge.includes('.png')) imgLarge += '.png';
            
            // Build the Name (prefer English over Japanese)
            let idealName = jpc.english_name ? jpc.english_name : jpc.name;
            
            if (!thc) {
                // MISSING SECRET RARE! Insert it 
                updatesAndInserts.push({
                    id: `${setId}-${numStr}-TH`,
                    set_id: setId,
                    language: 'th',
                    number: numStr,
                    name: idealName,
                    english_name: jpc.english_name,
                    rarity: jpc.rarity,
                    image_small: imgSmall,
                    image_large: imgLarge
                });
            } else {
                // EXISTS. Re-check if images need `.png` OR if name is Japanese
                let needsFix = false;
                let fixThcImgSmall = thc.image_small;
                let fixThcImgLarge = thc.image_large;
                let fixThcName = thc.name;
                
                // Fix missing .png
                if (fixThcImgSmall && fixThcImgSmall.includes('tcgdex.net') && !fixThcImgSmall.includes('.png')) {
                    fixThcImgSmall += '.png';
                    needsFix = true;
                }
                if (fixThcImgLarge && fixThcImgLarge.includes('tcgdex.net') && !fixThcImgLarge.includes('.png')) {
                    fixThcImgLarge += '.png';
                    needsFix = true;
                }
                
                // Fix Japanese characters in Thai Name (swap with English name instead of Japanese)
                if (jpKanjihiraganaRegex.test(fixThcName)) {
                    fixThcName = thc.english_name || jpc.english_name || jpc.name;
                    needsFix = true;
                }
                
                if (needsFix) {
                    updatesAndInserts.push({
                        id: thc.id,
                        name: fixThcName,
                        image_small: fixThcImgSmall,
                        image_large: fixThcImgLarge
                    });
                }
            }
        }
        
        if (updatesAndInserts.length > 0) {
            console.log(`==== Set ${setId}: Inserting/Fixing ${updatesAndInserts.length} items (Secret Rares + bugs) ====`);
            for(let i=0; i<updatesAndInserts.length; i+=100) {
                await supabase.from('pokemon_cards').upsert(updatesAndInserts.slice(i, i+100));
            }
        }
    }
    console.log("Perfect Sync complete!");
}

fix();
