const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');

const anonKeyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const anonKey = anonKeyMatch[1].trim();
const supabaseUrl = urlMatch[1].trim();
const apiUrl = `${supabaseUrl}/functions/v1/batch-price-english`;

const supabase = createClient(
    supabaseUrl,
    anonKey // just need basic query
);

async function finishSync() {
    console.log("Fetching sets that still need to be priced...");

    // We want to just trigger the edge function for sets that aren't fully priced.
    // Let's just trigger them all one by one, the edge function handles skipping quickly.

    // Get all EN cards grouped by set
    const { data: enCards, error } = await supabase
        .from('pokemon_cards')
        .select('set_id, id')
        .eq('language', 'en');

    if (error) {
        console.error("Error fetching cards:", error);
        return;
    }

    const sets = [...new Set(enCards.map(c => c.set_id))];
    console.log(`Found ${sets.length} English sets to process.`);

    // Trigger the edge function for each set
    for (let i = 0; i < sets.length; i++) {
        const setId = sets[i];
        console.log(`[${i + 1}/${sets.length}] Triggering sync for set: ${setId}`);

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${anonKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ setId: setId })
            });

            const data = await response.json();
            console.log(`  -> ${data.message || 'Started'}`);

            // Wait 5 seconds between triggers so we don't bombard JustTCG or exhaust edge concurrency
            await new Promise(r => setTimeout(r, 5000));

        } catch (e) {
            console.error(`  -> Error on ${setId}:`, e.message);
        }
    }
    console.log("Done launching set-specific background tasks.");
}

finishSync();
