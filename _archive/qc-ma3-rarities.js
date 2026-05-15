/**
 * QC script: compare MA3 Thai card rarities against me02.5 English cards (Ascended Heroes).
 * Outputs mismatches where a Thai card's rarity doesn't align with its English counterpart.
 * 
 * Thai rarity mapping:
 *   C  = Common        → EN Common
 *   U  = Uncommon      → EN Uncommon  
 *   R  = Rare          → EN Rare
 *   RR = Double Rare   → EN Double Rare
 *   SR = Super Rare    → EN Ultra Rare
 *   AR = Art Rare      → EN Illustration Rare
 *   SAR= Special Art Rare → EN Special Illustration Rare
 *   UR = Ultra Rare    → EN Hyper Rare
 *   MA = Master Art    → EN (no exact match - typically promo/special)
 */
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env.local.clean'), 'utf8')
    .split('\n')
    .forEach(l => {
        const [k, ...v] = l.split('=');
        if (k && v.length) env[k.trim()] = v.join('=').trim();
    });

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

// Thai → English rarity equivalents
const RARITY_MAP = {
    'C': 'Common',
    'U': 'Uncommon',
    'R': 'Rare',
    'RR': 'Double Rare',
    'SR': 'Ultra Rare',
    'AR': 'Illustration Rare',
    'SAR': 'Special Illustration Rare',
    'UR': 'Hyper Rare',
    'PB': 'Promo',
    'EH': 'Promo',
    'MA': null, // Special Art - no direct en rarity
};

async function main() {
    console.log('=== QC Thai MA3 Card Rarities ===\n');

    // Get all MA3 Thai cards with rarity
    const { data: thaiCards, error: thaiErr } = await sb
        .from('pokemon_cards')
        .select('id, name, number, rarity')
        .eq('set_id', 'MA3')
        .eq('language', 'th')
        .order('number');
    if (thaiErr) throw new Error(thaiErr.message);
    console.log(`Fetched ${thaiCards.length} MA3 Thai cards\n`);

    // Get all me02.5 English cards
    const { data: enCards, error: enErr } = await sb
        .from('pokemon_cards')
        .select('id, name, number, rarity')
        .eq('set_id', 'me02.5')
        .eq('language', 'en');
    if (enErr) throw new Error(enErr.message);

    const enByNumber = new Map();
    for (const c of enCards) {
        const num = String(c.number).replace(/^0+/, '');
        enByNumber.set(num, c);
        enByNumber.set(String(c.number), c);
    }

    // Show all Thai cards with AR rarity so user can verify
    const arCards = thaiCards.filter(c => c.rarity === 'AR');
    console.log(`=== Cards labeled AR (${arCards.length} total) ===`);
    console.log('Number | Thai Name                     | EN Equivalent Name     | EN Rarity');
    console.log('-------|-------------------------------|------------------------|------------------');
    for (const thai of arCards) {
        const thaiNum = String(thai.number).replace(/^0+/, '');
        const en = enByNumber.get(thaiNum) || enByNumber.get(String(thai.number));
        const enName = en ? en.name.substring(0, 22) : '(no match)'.padEnd(22);
        const enRarity = en ? en.rarity : '???';
        const mismatch = en && en.rarity !== 'Illustration Rare' ? ' ← MISMATCH' : '';
        console.log(`${String(thai.number).padEnd(6)} | ${thai.name.substring(0, 29).padEnd(29)} | ${enName.padEnd(22)} | ${enRarity}${mismatch}`);
    }

    // Also show rarity breakdown
    console.log('\n=== Rarity breakdown for MA3 Thai cards ===');
    const rarityCount = {};
    for (const c of thaiCards) {
        rarityCount[c.rarity || 'null'] = (rarityCount[c.rarity || 'null'] || 0) + 1;
    }
    for (const [rarity, count] of Object.entries(rarityCount).sort()) {
        console.log(`  ${rarity.padEnd(6)}: ${count}`);
    }

    // Show mismatches: Thai AR that doesn't map to EN Illustration Rare
    const mismatches = arCards.filter(thai => {
        const thaiNum = String(thai.number).replace(/^0+/, '');
        const en = enByNumber.get(thaiNum) || enByNumber.get(String(thai.number));
        return en && en.rarity !== 'Illustration Rare';
    });

    console.log(`\n=== Definite mismatches: Thai AR ≠ EN Illustration Rare (${mismatches.length}) ===`);
    for (const thai of mismatches) {
        const thaiNum = String(thai.number).replace(/^0+/, '');
        const en = enByNumber.get(thaiNum) || enByNumber.get(String(thai.number));
        console.log(`  #${thai.number} ${thai.name} → EN: "${en.name}" (${en.rarity})`);
    }

    // Also show EN rarity distribution for Ascended Heroes
    console.log('\n=== me02.5 English rarity breakdown ===');
    const enRarityCount = {};
    for (const c of enCards) {
        enRarityCount[c.rarity || 'null'] = (enRarityCount[c.rarity || 'null'] || 0) + 1;
    }
    for (const [rarity, count] of Object.entries(enRarityCount).sort()) {
        console.log(`  ${rarity.padEnd(30)}: ${count}`);
    }
}

main().catch(console.error);
