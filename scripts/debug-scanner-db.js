
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

async function debugThaiCardSearch() {
    console.log('🔹 Debugging Thai Card Search...\n');

    // 1. Fetch a real card from MA3 to see what data fields look like
    console.log('🔍 Fetching ANY card from set MA3...');
    const { data: sampleCards, error: sampleError } = await supabase
        .from('pokemon_cards')
        .select('*')
        .eq('set_id', 'MA3')
        .limit(3);

    if (sampleError) {
        console.error('❌ Error fetching sample:', sampleError.message);
        return;
    }

    if (!sampleCards || sampleCards.length === 0) {
        console.error('❌ No cards found in set MA3! Import might have failed or set_id is different.');
        return;
    }

    console.log('📋 Sample MA3 Cards Data:');
    sampleCards.forEach(c => {
        console.log(`   ID: ${c.id}`);
        console.log(`   Name: "${c.name}"`);
        console.log(`   English Name: "${c.english_name}"`); // Check if this is populated!
        console.log(`   Number: "${c.number}"`);
        console.log('   ---');
    });

    // 2. Test exact search with one of the real cards found
    if (sampleCards.length > 0) {
        const target = sampleCards[0];
        const searchName = target.english_name || target.name || '';

        if (!searchName) {
            console.log('⚠️ Skipping search test because target card has no name or english_name.');
            return;
        }

        console.log(`\n🔍 Testing Search Logic for: "${searchName}" (Number: ${target.number})...`);

        // Test the OR query logic
        const { data: searchResults, error: searchError } = await supabase
            .from('pokemon_cards')
            .select('*')
            .or(`name.ilike.%${searchName}%,english_name.ilike.%${searchName}%`)
            .eq('number', target.number)
            .limit(5);

        if (searchError) {
            console.error('❌ Search Query Error:', searchError.message);
        } else {
            console.log(`✅ Search result count: ${searchResults.length}`);
            if (searchResults.length > 0) {
                console.log(`   Found: ${searchResults[0].name} (${searchResults[0].id})`);
            } else {
                console.log('❌ Failed to find card using the OR query logic.');
            }
        }
    }
}

debugThaiCardSearch();
