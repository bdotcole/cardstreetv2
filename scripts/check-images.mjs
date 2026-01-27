// Quick database check for image URLs
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

console.log('🔍 Checking Image URLs in Database...\n');

const response = await fetch(`${SUPABASE_URL}/rest/v1/pokemon_cards?select=id,name,image_small,image_large,raw_data&limit=10`, {
    headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    }
});

const data = await response.json();

console.log(`✅ Found ${data.length} cards\n`);

data.forEach((card, i) => {
    console.log(`${i + 1}. ${card.name}`);
    console.log(`   ID: ${card.id}`);
    console.log(`   image_small: ${card.image_small || 'NULL'}`);
    console.log(`   image_large: ${card.image_large || 'NULL'}`);
    if (card.raw_data?.image) {
        console.log(`   raw_data.image: ${card.raw_data.image}`);
    }
    console.log('');
});
