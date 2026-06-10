const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    console.log("Checking DB for Japanese named cards within 'th' language designation...");
    let jpKanjihiraganaRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
    
    // Process in batches if > 1000
    let totalDeleted = 0;
    
    // we query all TH cards
    let offset = 0;
    const limit = 1000;
    
    while(true) {
        const { data: imgCards, error } = await supabase
            .from('pokemon_cards')
            .select('id, name')
            .eq('language', 'th')
            .range(offset, offset + limit - 1);
            
        if (error || !imgCards || imgCards.length === 0) break;
        
        let toDelete = [];
        for (let c of imgCards) {
            if (jpKanjihiraganaRegex.test(c.name)) {
                toDelete.push(c.id);
            }
        }
        
        if (toDelete.length > 0) {
            console.log(`Found ${toDelete.length} Japanese named cards in this batch of ${imgCards.length}. Deleting...`);
            // Supabase delete doesn't accept arrays easily unless we chain `in` filters
            // But we can just loop over 100 at a time using 'in'
            for(let i=0; i<toDelete.length; i+=100) {
                let chunk = toDelete.slice(i, i+100);
                await supabase.from('pokemon_cards').delete().in('id', chunk);
                totalDeleted += chunk.length;
            }
        }
        
        if (imgCards.length < limit) break; // Last batch
        offset += limit;
    }
    
    console.log(`Deletion complete. Removed a total of ${totalDeleted} Japanese named cards from Thai sets.`);
}

run();
