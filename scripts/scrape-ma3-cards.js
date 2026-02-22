// Scrape MA3 card details from asia.pokemon-card.com
// Run with: node scripts/scrape-ma3-cards.js
// This fetches each card's detail page and extracts Thai name, card number, rarity, etc.
// Output: scripts/ma3-cards-data.json

const fs = require('fs');
const path = require('path');

// All 486 card IDs scraped from the list pages
const CARD_IDS = ["12911", "13531", "13532", "12912", "13533", "13534", "12913", "12914", "13535", "13536", "12915", "13537", "13538", "12916", "13539", "13540", "12917", "13541", "13542", "12918", "13543", "13544", "12919", "13545", "13546", "12920", "13547", "13548", "12921", "13549", "13550", "12922", "13551", "13552", "12923", "13553", "13554", "12924", "13555", "13556", "12925", "13557", "13558", "12926", "13559", "13560", "12927", "12928", "13561", "13562", "12929", "13563", "13564", "12930", "13565", "13566", "12931", "12932", "13567", "13568", "12933", "13569", "13570", "12934", "13571", "13572", "12935", "13573", "13574", "12936", "13575", "13576", "12937", "13577", "13578", "12938", "13579", "13580", "12939", "12940", "13581", "13582", "12941", "12942", "13583", "13584", "12943", "13585", "13586", "12944", "13587", "13588", "12945", "13589", "13590", "12946", "12947", "13591", "13592", "12948", "13593", "13594", "12949", "13595", "13596", "12950", "13597", "13598", "12951", "13599", "13600", "12952", "13601", "13602", "12953", "13603", "13604", "12954", "12955", "13605", "13606", "12956", "13607", "13608", "12957", "13609", "13610", "12958", "13611", "13612", "12959", "12960", "13613", "13614", "12961", "12962", "13615", "13616", "12963", "13617", "13618", "12964", "13619", "13620", "12965", "13621", "13622", "12966", "13623", "13624", "12967", "12968", "13625", "13626", "12969", "13627", "13628", "12970", "12971", "13629", "13630", "12972", "13631", "13632", "12973", "12974", "13633", "13634", "12975", "13635", "13636", "12976", "13637", "13638", "12977", "13639", "13640", "12978", "13641", "13642", "12979", "13643", "13644", "12980", "13645", "13646", "12981", "12982", "13647", "13648", "12983", "13649", "13650", "12984", "13651", "13652", "12985", "12986", "13653", "13654", "12987", "13655", "13656", "12988", "13657", "13658", "12989", "13659", "13660", "12990", "13661", "13662", "12991", "13663", "13664", "12992", "13665", "13666", "12993", "13667", "13668", "12994", "13669", "13670", "12995", "13671", "13672", "12996", "13673", "13674", "12997", "13675", "13676", "12998", "13677", "13678", "12999", "13679", "13680", "13000", "13001", "13681", "13682", "13002", "13003", "13683", "13684", "13004", "13005", "13685", "13686", "13006", "13687", "13688", "13007", "13689", "13690", "13008", "13691", "13692", "13009", "13693", "13694", "13010", "13695", "13696", "13156", "13012", "13697", "13698", "13013", "13699", "13700", "13014", "13701", "13702", "13015", "13703", "13704", "13016", "13705", "13706", "13017", "13707", "13708", "13018", "13709", "13710", "13019", "13711", "13712", "13020", "13021", "13713", "13714", "13022", "13023", "13715", "13716", "13024", "13025", "13717", "13718", "13026", "13719", "13720", "13027", "13721", "13722", "13028", "13723", "13724", "13029", "13030", "13725", "13726", "13031", "13727", "13728", "13032", "13033", "13034", "13729", "13730", "13035", "13731", "13732", "13036", "13037", "13733", "13734", "13038", "13735", "13736", "13039", "13737", "13738", "13040", "13739", "13740", "13041", "13741", "13742", "13042", "13743", "13744", "13043", "13745", "13746", "13044", "13045", "13747", "13748", "13046", "13749", "13750", "13047", "13751", "13752", "13048", "13753", "13754", "13049", "13755", "13756", "13050", "13757", "13758", "13051", "13759", "13760", "13052", "13761", "13762", "13053", "13763", "13764", "13054", "13765", "13766", "13055", "13056", "13057", "13058", "13059", "13060", "13061", "13062", "13063", "13064", "13065", "13066", "13067", "13068", "13069", "13070", "13071", "13072", "13073", "13074", "13075", "13076", "13077", "13078", "13079", "13080", "13081", "13082", "13083", "13084", "13085", "13086", "13087", "13088", "13089", "13090", "13091", "13092", "13093", "13094", "13095", "13096", "13097", "13098", "13099", "13100", "13101", "13102", "13103", "13238", "13239", "13240", "13241", "13242", "13243", "13244", "13245", "13246", "13247", "13248", "13249", "13250", "13251", "13252", "13253", "13254", "13255", "13256", "13257", "13258", "13259", "13260", "13261", "13262", "13263", "13264", "13265", "13266", "13267", "13268", "13269", "13270", "13271", "13272", "13273", "13274", "13275", "13276", "13277", "13278", "13279", "13280", "13281", "13282", "13283", "13284", "13285", "13286", "13287", "13288", "13289", "13290", "13291", "13292", "13293", "13294"];

// Known Pokédex number to English name mapping (covers all Gen 1-9)
// We'll use this to map Thai card names to English
const POKEDEX_ENGLISH = {};

// Parse the HTML of a card detail page to extract card data
function parseCardDetail(html, siteId) {
    const card = { siteId };

    // Extract card name (Thai)
    // 1. Try <title> tag first (most reliable usually)
    // Format: "Card Name | Website Title"
    const titleMatch = html.match(/<title>([^|]+)\s*\|\s*[^<]+<\/title>/i);
    if (titleMatch) {
        card.thaiName = titleMatch[1].trim()
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    }

    // 2. Fallback to h1 if title failed
    if (!card.thaiName || card.thaiName === 'เว็บไซต์เทรนเนอร์') {
        // H1 often contains <span> for stage, so we need to be careful
        // Regex to get content of h1, stripping child tags
        // <h1 ...> ... <span>...</span>  TARGET_TEXT </h1>
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) {
            let h1Content = h1Match[1];
            // Remove span tags and their content (e.g. stage markers)
            h1Content = h1Content.replace(/<span[^>]*>[\s\S]*?<\/span>/yi, '');
            // Remove remaining tags
            h1Content = h1Content.replace(/<[^>]+>/g, '');
            card.thaiName = h1Content.trim()
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        }
    }

    // 3. Fallback to og:title ONLY if it's not the generic one
    if (!card.thaiName || card.thaiName === 'เว็บไซต์เทรนเนอร์') {
        const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        if (ogTitleMatch && ogTitleMatch[1] !== 'เว็บไซต์เทรนเนอร์') {
            card.thaiName = ogTitleMatch[1].trim();
        }
    }

    // Safety check
    if (card.thaiName === 'เว็บไซต์เทรนเนอร์') card.thaiName = 'Unknown Card';

    // Extract card number (like 001/193) - appears in card detail section
    const cardNumberMatch = html.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (cardNumberMatch) {
        card.number = cardNumberMatch[1].padStart(3, '0');
        card.totalInSet = cardNumberMatch[2];
    }

    // For secret rares (number > 193), look for different patterns
    if (!card.number) {
        const altNumberMatch = html.match(/No\.\s*(\d+)/);
        if (altNumberMatch) card.number = altNumberMatch[1];
    }

    // Extract Pokédex number for English name mapping
    const pokedexMatch = html.match(/No\.\s*(\d{1,4})\s/);
    if (pokedexMatch) {
        card.pokedexNumber = parseInt(pokedexMatch[1]);
    }

    // Extract rarity - look for rarity markers
    // Specific to this site: <span class="alpha"> Rarity </span>
    const alphaMatch = html.match(/<span[^>]*class="[^"]*alpha[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (alphaMatch) {
        card.rarity = alphaMatch[1].trim();
    } else {
        // Fallback patterns
        const rarityPatterns = [
            /<span[^>]*class="[^"]*rarity[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<img[^>]*class="[^"]*rarity[^"]*"[^>]*alt="([^"]+)"/i
        ];
        for (const pattern of rarityPatterns) {
            const match = html.match(pattern);
            if (match) {
                card.rarity = match[1].trim();
                break;
            }
        }
    }

    // Extract image URL
    card.imageUrl = `https://asia.pokemon-card.com/th/card-img/th${String(siteId).padStart(8, '0')}.png`;

    // Extract supertype (Pokemon, Trainer, Energy)
    // Detailed check to avoid false positives from footer links
    const isPokemon = html.match(/<span[^>]*class="[^"]*hitPoint[^"]*"[^>]*>HP<\/span>/i);
    if (isPokemon) {
        card.supertype = 'Pokémon';
    } else if (card.thaiName && (card.thaiName.includes('พลังงาน') || card.thaiName.includes('Energy'))) {
        card.supertype = 'Energy';
    } else if (card.thaiName && (card.thaiName.includes('คำสั่ง') || card.thaiName.includes('ไอเท็ม') || card.thaiName.includes('ซัพพอร์ต') || card.thaiName.includes('สเตเดียม'))) {
        card.supertype = 'Trainer';
    } else {
        // Default to Pokemon if not clear, or check for specific trainer text in body
        if (html.includes('Trainer') && !html.includes('HP</span>')) card.supertype = 'Trainer';
        else card.supertype = 'Pokémon'; // Fallback
    }

    // Extract HP
    const hpMatch = html.match(/HP\s*(\d+)/i);
    if (hpMatch) card.hp = parseInt(hpMatch[1]);

    return card;
}

// Delay helper
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAllCards() {
    console.log('🔍 MA3 Card Scraper — Fetching detail pages...\n');
    console.log(`📊 Total cards to scrape: ${CARD_IDS.length}\n`);

    const cards = [];
    const errors = [];

    // Process in batches to avoid overwhelming the server
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second between batches

    for (let i = 0; i < CARD_IDS.length; i += BATCH_SIZE) {
        const batch = CARD_IDS.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (cardId) => {
            const url = `https://asia.pokemon-card.com/th/card-search/detail/${cardId}/`;
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const html = await response.text();
                const card = parseCardDetail(html, cardId);
                return card;
            } catch (err) {
                console.error(`  ❌ Error fetching card ${cardId}: ${err.message}`);
                errors.push({ id: cardId, error: err.message });
                return null;
            }
        });

        const results = await Promise.all(batchPromises);
        results.filter(Boolean).forEach(card => cards.push(card));

        const progress = Math.min(i + BATCH_SIZE, CARD_IDS.length);
        process.stdout.write(`  ✅ Scraped ${progress}/${CARD_IDS.length} cards (${errors.length} errors)\r`);

        if (i + BATCH_SIZE < CARD_IDS.length) {
            await delay(DELAY_BETWEEN_BATCHES);
        }
    }

    console.log(`\n\n📊 Scrape Summary:`);
    console.log(`   ✅ Successfully scraped: ${cards.length}`);
    console.log(`   ❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
        console.log('\n   Error IDs:', errors.map(e => e.id).join(', '));
    }

    // Show sample cards
    console.log('\n📋 Sample cards:');
    cards.slice(0, 5).forEach(c => {
        console.log(`   ${c.number || '???'} | ${c.thaiName || 'No Name'} | ${c.rarity || '?'} | ${c.supertype}`);
    });

    // Save to JSON file
    const outputPath = path.join(__dirname, 'ma3-cards-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(cards, null, 2), 'utf-8');
    console.log(`\n💾 Data saved to: ${outputPath}`);
    console.log('   Run "node scripts/import-ma3-set.js" to import into Supabase.\n');
}

scrapeAllCards().catch(console.error);
