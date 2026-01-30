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
    console.log('--- Debugging Japanese Card Data ---');

    console.log("Searching for 'Pikachu' (English name) in Japanese cards...");
    const { data: pikasEn } = await supabase
        .from('pokemon_cards')
        .select('name, set_id')
        .eq('language', 'ja')
        .ilike('name', '%Pikachu%')
        .limit(5);

    console.log("Results (EN):", pikasEn);

    console.log("Searching for 'ピカチュウ' (Japanese name)...");
    const { data: pikasJp } = await supabase
        .from('pokemon_cards')
        .select('name, set_id')
        .eq('language', 'ja')
        .ilike('name', '%ピカチュウ%')
        .limit(5);

    console.log("Results (JP):", pikasJp);
}
debug();
