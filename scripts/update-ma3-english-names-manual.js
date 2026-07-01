
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

// Manual Dictionary for Trainers/Energy/Special Cards
const THAI_TO_ENGLISH = {
    // Trainers
    'ยาเพิ่มพลังงานของ N': 'N\'s Elixir',
    'เอนเนอร์จี้รีไซเคิล': 'Energy Recycler',
    'ค้อนสลายพลังงาน': 'Crushing Hammer',
    'ทรัมเป็ตแก้ว': 'Glass Trumpet',
    'ขี้เถ้าศักดิ์สิทธิ์': 'Sacred Ash',
    'ทูลสแครปเปอร์': 'Tool Scrapper',
    'ลูกแก้วเทรัสตัล': 'Terastal Orb',
    'โปฟฟินมิตรภาพ': 'Buddy-Buddy Poffin',
    'พาวเวอร์โปรตีน': 'Power Protein',
    'ฆ้องต่อสู้': 'Fighting Gong', // Check official name
    'กระเป๋าของฮ็อป': 'Hop\'s Bag',
    'ชุดจับแมลง': 'Bug Catching Set',
    'เมก้าซิกแนล': 'Mega Signal', // Check official name
    'เปลหามยามราตรี': 'Night Stretcher',
    'รีซีฟเวอร์ของแก๊งร็อกเกต': 'Team Rocket\'s Receiver', // Check official name
    'เคาน์เตอร์เกน': 'Counter Gain',
    'เวทเสริมพลังของชิโรนะ': 'Cynthia\'s Power Weight', // Check official name
    'ลูกแก้วไฟฟ้า': 'Electric Orb', // Check official name
    'เกล็ดหนาเตอะ': 'Thick Scales', // Check official name
    'ลูกโป่ง': 'Air Balloon',
    'กำไลแห่งความกล้า': 'Legacy Energy', // OR similar ACE SPEC? Need verify
    'ผ้าคาดหัวแห่งความแน่วแน่ของฮ็อป': 'Hop\'s Determination Headband',
    'จิตนักสู้ของไอริส': 'Iris\'s Fighting Spirit',
    'ความซุกซนของอเซโรลา': 'Acerola\'s Premonition', // or Mischief?
    'คานารี': 'Kahili', // Likely Kahili or similar
    'นักโต้คลื่น': 'Surfer',
    'โทโกะ': 'Toko', // Check official name
    'เวอร์บีนากับเฮเลนา': 'Verbena & Helena', // Check official name
    'การผจญภัยของฮิบิกิ': 'Ethan\'s Adventure',
    'ปณิธานของลิเลีย': 'Lillie\'s Wish', // or similar
    'อาเธนาแห่งแก๊งร็อกเกต': 'Team Rocket\'s Athena', // Check official name
    'อพอลโลแห่งแก๊งร็อกเกต': 'Team Rocket\'s Apollo',
    'ซากากิแห่งแก๊งร็อกเกต': 'Giovanni\'s Charisma', // Maybe? Or Team Rocket's Giovanni
    'แลมป์ดาแห่งแก๊งร็อกเกต': 'Team Rocket\'s Lambda',
    'แลนซ์แห่งแก๊งร็อกเกต': 'Team Rocket\'s Lance',
    'ปราสาทของ N': 'N\'s Castle',
    'ป่าเปี่ยมพลัง': 'Energizing Forest', // or similar
    'กราวิตีเมาน์เทน': 'Gravity Mountain',
    'โพรงถ้ำใหญ่ซีโร่': 'Area Zero Underdepths',
    'ฮักโคซิตี้': 'Levincia',
    'เฟอร์ลองทาวน์': 'Furlong Town', // or similar
    'มิสเทรีการ์เด้น': 'Mystery Garden', // or similar
    'เหมืองยามราตรี': 'Night Mine', // or similar
    'หอเฝ้าระวังของแก๊งร็อกเกต': 'Team Rocket\'s Watchtower',
    'โรงงานของแก๊งร็อกเกต': 'Team Rocket\'s Factory',
    'พลังงานจุดระเบิด': 'Combustion Energy', // or similar
    'ปริซึมเอนเนอร์จี้': 'Prism Energy',
    'พลังงานแก๊งร็อกเกต': 'Team Rocket Energy',
    'ไฮเปอร์บอล': 'Ultra Ball',
    'การฝึกซ้อมของโปรคาราเต้': 'Karate Pro Training', // or similar
    'แจมมิงทาวเวอร์': 'Jamming Tower'
};

async function fetchPokemonName(pokedexNumber) {
    if (!pokedexNumber) return null;
    try {
        const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${pokedexNumber}`);
        if (!response.ok) return null;
        const data = await response.json();
        // Capitalize first letter
        return data.name.charAt(0).toUpperCase() + data.name.slice(1);
    } catch (e) {
        console.error(`Error fetching Pokedex #${pokedexNumber}:`, e.message);
        return null;
    }
}

async function updateEnglishNamesManual() {
    console.log('🔹 Starting Manual English Name Update for MA3...');

    // Load local data
    const dataPath = path.join(__dirname, 'ma3-cards-data.json');
    if (!fs.existsSync(dataPath)) {
        console.error('❌ ma3-cards-data.json not found!');
        return;
    }
    const localData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log(`📊 Loaded ${localData.length} cards from local JSON.`);

    // Helper map: Card Number -> Local Data
    // Note: Numbers might be repeated for variants, but name should be same
    const numberToData = new Map();
    localData.forEach(c => {
        numberToData.set(c.number, c);
    });

    // Fetch cards from DB that need update
    const { data: dbCards, error } = await supabase
        .from('pokemon_cards')
        .select('id, name, number, set_id')
        .eq('set_id', 'MA3')
        .is('english_name', null);

    if (error) {
        console.error('Error fetching DB cards:', error);
        return;
    }
    console.log(`📋 Found ${dbCards.length} cards in DB missing English names.`);

    for (const card of dbCards) {
        // Find matching local data
        // Try exact number match first (MA3-001 -> 001)
        const numPart = card.number.split('/')[0]; // Handle '001/193' if stored like that, but scrape stored '001'
        const localCard = numberToData.get(numPart);

        let englishName = null;

        if (localCard) {
            // Strategy 1: Manual Dictionary (Trainers/Energy or known items)
            if (THAI_TO_ENGLISH[localCard.thaiName]) {
                englishName = THAI_TO_ENGLISH[localCard.thaiName];
            }
            // Strategy 2: PokeAPI (Pokemon)
            else if (localCard.pokedexNumber) {
                // Rate limit slightly
                await new Promise(r => setTimeout(r, 100));
                const pName = await fetchPokemonName(localCard.pokedexNumber);
                if (pName) {
                    englishName = pName;
                    // Handle special suffixes manually if needed (e.g. " ex")
                    // If Thai name has "ex", append " ex"
                    if (localCard.thaiName.toLowerCase().includes('ex')) {
                        if (!englishName.toLowerCase().endsWith('ex')) {
                            englishName += ' ex';
                        }
                    }
                    if (localCard.thaiName.toLowerCase().includes('vmax')) englishName += ' VMAX';
                    if (localCard.thaiName.toLowerCase().includes('vstar')) englishName += ' VSTAR';
                }
            }
        }

        if (englishName) {
            console.log(`✅ Updating ${card.id}: ${card.name} -> ${englishName}`);
            await supabase
                .from('pokemon_cards')
                .update({ english_name: englishName })
                .eq('id', card.id);
        } else {
            console.warn(`⚠️ Could not determine English name for ${card.id} (${card.name})`);
        }
    }

    console.log('✨ Manual update complete!');
}

updateEnglishNamesManual();
