/**
 * diagnose-ma3-matching.js
 * Shows exactly what MA3 SAR/MUR cards have as english_name, 
 * and whether matching EN cards exist in any set.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname,'..', '.env.local'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g,'');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const RARITY_MAP = {
    'SAR': ['Special Illustration Rare'],
    'MUR': ['Hyper Rare'],
    'AR':  ['Illustration Rare'],
    'MA':  ['Ultra Rare'],
    'SR':  ['Ultra Rare'],
    'UR':  ['Hyper Rare'],
};

function similarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
    if (a === b) return 1.0;
    const m = a.length, n = b.length;
    const dp = Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
        dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j-1],dp[i][j-1],dp[i-1][j]);
    return (Math.max(m,n)-dp[m][n])/Math.max(m,n);
}

async function main() {
    // 1) Get MA3 high-rarity Thai cards
    const { data: thaiCards } = await supabase
        .from('pokemon_cards')
        .select('id, name, english_name, rarity, number')
        .eq('set_id', 'MA3')
        .eq('language', 'th')
        .in('rarity', ['SAR','MUR','AR','MA','SR','UR'])
        .order('rarity');

    console.log(`\n=== MA3 High-Rarity Thai Cards (${thaiCards?.length}) ===`);
    for (const c of thaiCards || []) {
        console.log(`  [${c.rarity}] #${c.number}  english_name="${c.english_name}"  thai="${c.name}"`);
    }

    // 2) Get all existing card_mappings for these cards
    const thIds = (thaiCards||[]).map(c=>c.id);
    const { data: mappings } = await supabase
        .from('card_mappings')
        .select('card_id_th, card_id_en, match_method, confidence_score')
        .in('card_id_th', thIds);

    const mappedThIds = new Set((mappings||[]).map(m=>m.card_id_th));
    const unmapped = (thaiCards||[]).filter(c=>!mappedThIds.has(c.id));
    console.log(`\n=== Already mapped: ${mappings?.length}, Unmapped: ${unmapped.length} ===`);
    for (const c of unmapped) {
        console.log(`  UNMAPPED [${c.rarity}] "${c.english_name}" (#${c.number})`);
    }

    // 3) For each unmapped card, search EN database for best match
    console.log('\n=== Searching EN database for unmapped cards ===');
    for (const thaiCard of unmapped) {
        const enRarities = RARITY_MAP[thaiCard.rarity];
        const searchName = (thaiCard.english_name||'').toLowerCase().trim();
        if (!searchName) { console.log(`  SKIPPED (no english_name): ${thaiCard.name}`); continue; }

        // Search EN cards that contain the first meaningful word
        const words = searchName.split(' ').filter(w=>w.length>2);
        if (!words.length) { console.log(`  SKIPPED (short name): ${searchName}`); continue; }

        const { data: candidates } = await supabase
            .from('pokemon_cards')
            .select('id, name, rarity, set_id, number')
            .eq('language', 'en')
            .ilike('name', `%${words[0]}%`)
            .limit(50);

        let best = null, bestSim = 0;
        for (const en of candidates||[]) {
            const sim = similarity(searchName, en.name);
            const rarityOk = !enRarities || enRarities.some(r=>r.toLowerCase()===(en.rarity||'').toLowerCase());
            const score = rarityOk ? sim+0.05 : sim;
            if (score > bestSim) { bestSim = score; best = en; }
        }
        console.log(`  [${thaiCard.rarity}] "${thaiCard.english_name}" → best EN: "${best?.name}" (${best?.rarity}) in ${best?.set_id}, sim=${bestSim.toFixed(2)}`);
    }
}
main().catch(console.error);
