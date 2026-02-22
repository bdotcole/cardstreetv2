// Update English names for MA3 cards using Gemini
// Run with: node scripts/update-ma3-english-names.js

const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY }); // User needs to provide this or I'll hardcode if permitted... wait, I can use the one from env

async function updateEnglishNames() {
    console.log('🔹 Fetching MA3 cards with missing English names...');

    const { data: cards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, number')
        .eq('set_id', 'MA3')
        .is('english_name', null);

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    console.log(`📊 Found ${cards.length} cards to update.`);

    // Process in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        const batch = cards.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${i / BATCH_SIZE + 1}...`);

        const prompt = `Translate these Thai Pokémon card names to English. Return a JSON object where keys are the IDs and values are the English names.
        
        Cards:
        ${JSON.stringify(batch.map(c => ({ id: c.id, name: c.name })))}
        
        Rules:
        1. Use official English Pokémon names (e.g. "ลิซาร์ดอน" -> "Charizard").
        2. For Trainers/Items, use exact English TCG names.
        3. If uncertain, leave value as null.
        4. Return ONLY valid JSON.`;

        try {
            const result = await ai.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });

            console.log(`  raw response: ${result.text.substring(0, 50)}...`);
            const translations = JSON.parse(result.text);

            // Prepare updates
            for (const [id, englishName] of Object.entries(translations)) {
                if (englishName) {
                    await supabase
                        .from('pokemon_cards')
                        .update({ english_name: englishName })
                        .eq('id', id);
                }
            }
            console.log(`  ✅ Batch ${i / BATCH_SIZE + 1} updated.`);

        } catch (err) {
            console.error(`  ❌ Error processing batch:`, err);
        }
    }

    console.log('✨ Update complete!');
}

// Check for API key in a way that works in node script (might need to be passed in)
if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    console.warn("⚠️ NEXT_PUBLIC_GEMINI_API_KEY not found in env. Please run with: set NEXT_PUBLIC_GEMINI_API_KEY=... && node scripts/...");
}

updateEnglishNames();
