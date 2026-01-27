/**
 * Migrate Pokemon Card Images to Supabase Storage
 * This script downloads images from TCGdex and uploads to Supabase Storage
 * for better performance and reliability, especially in Southeast Asia
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

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
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'card-images'; // Will create if doesn't exist

console.log('🚀 Starting Pokemon Card Image Migration to Supabase Storage\n');

// Create temporary directory for downloads
const tempDir = path.join(__dirname, '..', 'temp_images');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Helper: Download image
async function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
}

// Helper: Upload to Supabase Storage
async function uploadToSupabase(filepath, storagePath) {
    const fileBuffer = fs.readFileSync(filepath);
    const fileBase64 = fileBuffer.toString('base64');

    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'apikey': SUPABASE_KEY,
            'Content-Type': 'image/png',
            'x-upsert': 'true' // Overwrite if exists
        },
        body: fileBuffer
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${error}`);
    }

    return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
}

// Main migration function
async function migrate() {
    console.log('📦 Step 1: Creating Supabase Storage bucket...');

    // Create bucket if it doesn't exist
    const createBucketResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: STORAGE_BUCKET,
            name: STORAGE_BUCKET,
            public: true,
            fileSizeLimit: 5242880, // 5MB max per image
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp']
        })
    });

    if (!createBucketResponse.ok && createBucketResponse.status !== 409) { // 409 = already exists
        console.error('Failed to create bucket:', await createBucketResponse.text());
        return;
    }
    console.log('✅ Bucket ready\n');

    console.log('📝 Step 2: Fetching card list from database...');
    const cardsResponse = await fetch(`${SUPABASE_URL}/rest/v1/pokemon_cards?select=id,image_large,image_small&limit=100`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });

    const cards = await cardsResponse.json();
    console.log(`✅ Found ${cards.length} cards to migrate\n`);

    let migrated = 0;
    let failed = 0;

    console.log('🔄 Step 3: Downloading and uploading images...\n');

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const progress = ((i + 1) / cards.length * 100).toFixed(1);

        if (!card.image_large && !card.image_small) {
            console.log(`⏭️  [${i + 1}/${cards.length}] ${card.id} - No images`);
            continue;
        }

        try {
            const tcgdexUrl = (card.image_large || card.image_small) + '.png';
            const filename = `${card.id}.png`;
            const tempPath = path.join(tempDir, filename);
            const storagePath = `pokemon/${filename}`;

            // Download from TCGdex
            await downloadImage(tcgdexUrl, tempPath);

            // Upload to Supabase
            const newUrl = await uploadToSupabase(tempPath, storagePath);

            // Update database
            await fetch(`${SUPABASE_URL}/rest/v1/pokemon_cards?id=eq.${card.id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    image_large: newUrl,
                    image_small: newUrl
                })
            });

            // Cleanup
            fs.unlinkSync(tempPath);

            migrated++;
            console.log(`✅ [${i + 1}/${cards.length}] (${progress}%) ${card.id}`);

        } catch (error) {
            failed++;
            console.log(`❌ [${i + 1}/${cards.length}] ${card.id} - ${error.message}`);
        }

        // Rate limiting
        if (i % 10 === 0) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('Migration Complete!');
    console.log('='.repeat(50));
    console.log(`✅ Migrated: ${migrated}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Total: ${cards.length}`);
}

migrate().catch(console.error);
