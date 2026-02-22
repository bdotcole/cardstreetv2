
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

async function testThaiScannerLogic() {
    console.log('🔹 Testing Thai Scanner Search Logic...\n');

    // MOCK DATA: Simulating what Gemini would return for a Thai card scan
    // Scenario: Scanned "Charizard" (English name returned) from Set "MA3" (Thai Set Code)
    const mockGeminiResult = {
        primary: {
            name: 'Charizard', // English Name returned by AI
            set: 'MA3',       // Thai Set Code returned as setHint
            number: '006'     // Number
        }
    };

    console.log(`🤖 Mock AI Output: Name="${mockGeminiResult.primary.name}", Set="${mockGeminiResult.primary.set}", Number="${mockGeminiResult.primary.number}"`);

    const cleanName = mockGeminiResult.primary.name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const cleanNumber = mockGeminiResult.primary.number;

    // 1. Simulate the updated DB Query (searching both name and english_name)
    console.log(`\n🔍 Executing DB Search for "${cleanName}" in set "${mockGeminiResult.primary.set}"...`);

    // NOTE: In the actual service we filter by name/number first, then verify set if needed
    // But here we test the specific query logic we implemented in pokemonService.ts
    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('*')
        .or(`name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`)
        .eq('number', cleanNumber) // Exact number match
        .eq('set_id', mockGeminiResult.primary.set); // Exact set match for logic verification

    if (error) {
        console.error('❌ DB Error:', error.message);
        return;
    }

    if (cards && cards.length > 0) {
        console.log(`✅ Success! Found ${cards.length} matching Thai card(s):`);
        cards.forEach(c => {
            console.log(`   - [${c.id}] ${c.name} (English: ${c.english_name}) Set: ${c.set_id} #${c.number}`);
        });
    } else {
        console.error('❌ Failed: No duplicates found. The OR query might not be working as expected.');
    }
}

testThaiScannerLogic();
