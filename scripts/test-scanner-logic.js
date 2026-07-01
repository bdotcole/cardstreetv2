
const { createClient } = require('@supabase/supabase-js');

// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of require('fs').readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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
