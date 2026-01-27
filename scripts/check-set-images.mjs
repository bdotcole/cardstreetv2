// Check what set image data is in the database
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');

// Load .env.local
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
            process.env[match[1].trim()] = match[2].trim();
        }
    });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('🔍 Checking Set Images in Database...\n');

const response = await fetch(`${SUPABASE_URL}/rest/v1/pokemon_sets?select=id,name,logo,symbol,images,raw_data&language=eq.en&limit=5`, {
    headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    }
});

const data = await response.json();

console.log(`✅ Found ${data.length} sets\n`);

data.forEach((set, i) => {
    console.log(`${i + 1}. ${set.name} (${set.id})`);
    console.log(`   logo: ${set.logo || 'NULL'}`);
    console.log(`   symbol: ${set.symbol || 'NULL'}`);
    console.log(`   images: ${set.images ? JSON.stringify(set.images) : 'NULL'}`);
    if (set.raw_data?.logo) {
        console.log(`   raw_data.logo: ${set.raw_data.logo}`);
    }
    console.log('');
});
