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

async function debug() {
    console.log('--- Debugging English Sets & Cards ---');

    console.log("Checking first 5 English Sets in DB...");
    const { data: sets } = await supabase
        .from('pokemon_sets')
        .select('*')
        .eq('language', 'en')
        .limit(5);

    sets.forEach(s => console.log(`[${s.id}] ${s.name} (Series: ${s.series})`));

    if (sets.length > 0) {
        const testSet = sets[0];
        console.log(`\nChecking cards for set '${testSet.name}' (${testSet.id})...`);
        const { data: cards } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id')
            .eq('set_id', testSet.id)
            .limit(5);

        console.log(`Found ${cards?.length || 0} cards.`);
        if (cards?.length > 0) console.log(cards[0]);
    }
}

debug();
