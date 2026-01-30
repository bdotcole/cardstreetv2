import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env vars manually
const envPath = path.resolve(process.cwd(), '.env.local');
const envVars = {};

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').trim().replace(/"/g, '');
            if (key && !key.startsWith('#')) envVars[key] = value;
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) { console.error('Missing credentials'); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
    console.log('--- Analyzing Japanese Card Set IDs ---');

    console.log("1. Total Japanese Set Count:");
    const { count: setsCount } = await supabase
        .from('pokemon_sets')
        .select('*', { count: 'exact', head: true })
        .eq('language', 'ja');
    console.log(`Sets: ${setsCount}`);

    console.log("\n2. Total Japanese Card Count:");
    const { count: cardsCount } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('language', 'ja');
    console.log(`Cards: ${cardsCount}`);

    console.log("\n3. Sample Cards from 'pokemon_cards' (language='ja'):");
    const { data: sampleCards } = await supabase
        .from('pokemon_cards')
        .select('id, name, set_id')
        .eq('language', 'ja')
        .limit(10);
    sampleCards?.forEach(c => console.log(`  [${c.id}] ${c.name} (set_id: '${c.set_id}')`));

    // Get all distinct set_ids from cards to see coverage
    console.log("\n4. distinct set_ids in cards table (first 50):");
    // Pagination allows only limited checking, let's grab a chunk
    const { data: cardSets } = await supabase
        .from('pokemon_cards')
        .select('set_id')
        .eq('language', 'ja')
        .limit(1000);

    // Count distribution
    const setCounts = {};
    cardSets?.forEach(c => {
        setCounts[c.set_id] = (setCounts[c.set_id] || 0) + 1;
    });

    console.log("Top 10 Sets by Card Count (Japanese):");
    Object.entries(setCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([id, count]) => console.log(`  '${id}': ${count} cards`));

    // Check specific sets that seemed empty
    const checkSets = ['CP3', 'XY10', 'cp3', 'xy10', 'CP3_JP'];
    console.log("\n5. Checking specific IDs:");

    for (const testId of checkSets) {
        const count = setCounts[testId] || 0;
        // Also check DB directly just in case local sample missed it
        const { count: dbCount } = await supabase
            .from('pokemon_cards')
            .select('*', { count: 'exact', head: true })
            .eq('set_id', testId);

        console.log(`  '${testId}' -> Sample: ${count}, DB Total: ${dbCount}`);
    }
}

analyze();
