// Import MA3 Thai Pokemon Set from asia.pokemon-card.com
// This script scrapes the Thai Pokemon card website and imports to Supabase
// Run with: node scripts/import-ma3-set.js
//
// Step 1: First run the browser scraper to generate the JSON data file
// Step 2: Then run this script to import the scraped data into Supabase

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase connection
const supabase = createClient(
    'https://fdxgzddvywtmnqsaqysx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU'
);

// Rarity mapping
function mapRarity(rawRarity) {
    const rarityMap = {
        'C': 'Common',
        'U': 'Uncommon',
        'R': 'Rare',
        'RR': 'Double Rare',
        'RRR': 'Triple Rare',
        'SR': 'Secret Rare',
        'UR': 'Ultra Rare',
        'AR': 'Art Rare',
        'SAR': 'Special Art Rare',
        'SSR': 'Super Secret Rare',
        'MUR': 'Muster Rare',
        'BWR': 'Black & White Rare',
        'I': 'Illustration Rare',
        'H': 'Holo Rare',
        'PR': 'Promo',
        'ACE': 'ACE SPEC Rare',
    };
    return rarityMap[rawRarity?.trim()] || rawRarity?.trim() || 'Unknown';
}

// Determine supertype from card data
function detectSupertype(thaiName, cardText) {
    const text = (thaiName + ' ' + (cardText || '')).toLowerCase();
    if (text.includes('พลังงาน') || text.includes('energy')) return 'Energy';
    if (text.includes('ไอเท็ม') || text.includes('สเตเดียม') || text.includes('ซัพพอร์ต') ||
        text.includes('item') || text.includes('stadium') || text.includes('supporter') ||
        text.includes('เทรนเนอร์') || text.includes('trainer') || text.includes('เครื่องมือ') ||
        text.includes('tool') || text.includes('ace spec')) return 'Trainer';
    return 'Pokémon';
}

async function importMA3Set() {
    console.log('🇹🇭 MA3 Set Import: วิวัฒนาการเมก้า ดรีมex\n');

    // Step 1: Create the set record
    console.log('📦 Step 1: Creating set record...');
    const setData = {
        id: 'MA3',
        name: 'วิวัฒนาการเมก้า ดรีมex',
        series: 'Mega Evolution',
        printed_total: 193,
        total: 486,
        release_date: '2025-11-21', // MA3 release date
        logo_url: 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4/2025/11/th_news_ma3_pkg.png',
        language: 'th'
    };

    // Check if set already exists
    const { data: existingSet } = await supabase
        .from('pokemon_sets')
        .select('id')
        .eq('id', 'MA3')
        .single();

    if (existingSet) {
        console.log('  ⏭️ Set MA3 already exists, updating...');
        const { error: updateError } = await supabase
            .from('pokemon_sets')
            .update(setData)
            .eq('id', 'MA3');
        if (updateError) console.error('  ❌ Update error:', updateError.message);
        else console.log('  ✅ Set updated successfully');
    } else {
        const { error: insertError } = await supabase
            .from('pokemon_sets')
            .insert([setData]);
        if (insertError) console.error('  ❌ Insert error:', insertError.message);
        else console.log('  ✅ Set created successfully');
    }

    // Step 2: Read the scraped card data
    const dataPath = path.join(__dirname, 'ma3-cards-data.json');
    if (!fs.existsSync(dataPath)) {
        console.error('\n❌ Card data file not found!');
        console.error('   Run the browser scraper first to generate: scripts/ma3-cards-data.json');
        console.error('   Use: node scripts/scrape-ma3-cards.js (or run the browser scraper)');
        return;
    }

    const allCards = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Deduplicate by siteId
    const uniqueCards = [];
    const siteIds = new Set();
    for (const card of allCards) {
        if (!siteIds.has(card.siteId)) {
            siteIds.add(card.siteId);
            uniqueCards.push(card);
        }
    }
    console.log(`\n📊 Step 2: Importing ${uniqueCards.length} unique cards (filtered from ${allCards.length})...`);

    // Handle card ID collisions (variants with same number)
    // Map of card number -> count
    const numberCounts = {};
    const cardsToImport = uniqueCards.map(card => {
        const number = card.number || '000';
        if (!numberCounts[number]) numberCounts[number] = 0;
        numberCounts[number]++;

        let cardId = `MA3-${number}`;
        // If this number has appeared before or will appear again (variants), make ID unique
        // We use siteId to ensure stability
        if (uniqueCards.filter(c => c.number === number).length > 1) {
            cardId = `MA3-${number}-${card.siteId}`;
        }

        return {
            ...card,
            pk_id: cardId // Use this as the ID
        };
    });

    const results = { success: 0, skipped: 0, errors: 0 };

    // Process in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < cardsToImport.length; i += BATCH_SIZE) {
        const batch = cardsToImport.slice(i, i + BATCH_SIZE);
        const batchData = [];

        for (const card of batch) {
            batchData.push({
                id: card.pk_id,
                name: card.thaiName || card.name || '',
                english_name: card.englishName || null,
                set_id: 'MA3',
                number: card.number,
                supertype: detectSupertype(card.thaiName || '', card.supertype || ''),
                rarity: mapRarity(card.rarity),
                image_large: card.imageUrl,
                image_small: card.imageUrl,
                language: 'th'
            });
        }

        // Upsert to handle existing cards
        const { error } = await supabase
            .from('pokemon_cards')
            .upsert(batchData, { onConflict: 'id' });

        if (error) {
            console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
            results.errors += batchData.length;
        } else {
            results.success += batchData.length;
            process.stdout.write(`  ✅ Imported ${results.success}/${cardsToImport.length} cards\r`);
        }
    }

    console.log(`\n\n📊 Import Summary:`);
    console.log(`   ✅ Imported: ${results.success}`);
    console.log(`   ❌ Errors: ${results.errors}`);
    console.log('\n✨ Import complete!\n');
}

importMA3Set().catch(console.error);
