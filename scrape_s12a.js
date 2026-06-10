const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Hardcoded based on .env
const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchPage(url) {
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    return await res.text();
}

async function scrape() {
    console.log("Fetching Japanese cards to map Rarity & English Names...");
    const { data: jaCards } = await supabase.from('pokemon_cards').select('id, number, rarity, english_name, name').eq('set_id', 'S12a').eq('language', 'ja');
    const jaMap = {};
    if (jaCards) {
        jaCards.forEach(c => jaMap[c.number] = c);
    }
    
    console.log("Fetching Asian Pokemon Card Site...");
    const baseListUrl = 'https://asia.pokemon-card.com/th/card-search/list/?expansionCodes=S12a&pageNo=';
    
    let detailUrls = [];
    for(let i=1; i<=9; i++) {
        console.log(`Getting page ${i}/9...`);
        const html = await fetchPage(baseListUrl + i);
        const matches = [...html.matchAll(/<li class="card">\s*<a href="([^"]+)">/g)];
        matches.forEach(m => detailUrls.push('https://asia.pokemon-card.com' + m[1]));
    }
    console.log(`Found ${detailUrls.length} card URLs.`);
    
    // Deduplicate just in case
    detailUrls = [...new Set(detailUrls)];
    
    const results = [];
    for(let i=0; i<detailUrls.length; i++) {
        const dUrl = detailUrls[i];
        if (i % 10 === 0) console.log(`Scraping card ${i+1}/${detailUrls.length}...`);
        
        try {
            const html = await fetchPage(dUrl);
            const titleMatch = html.match(/<title>([^<]+)\|/);
            const numMatch = html.match(/<span class="collectorNumber">\s*([^<]+)\s*<\/span>/);
            
            if (titleMatch && numMatch) {
                let thaiName = titleMatch[1].trim();
                let fullNum = numMatch[1].trim();
                let number = fullNum.split('/')[0];
                
                // Remove evolution prefix from thai name if present
                thaiName = thaiName.replace(/ร่าง 1\s+/, '').replace(/ร่าง 2\s+/, '').replace(/พื้นฐาน\s+/, '').replace(/VMAX\s+/, '').replace(/VSTAR\s+/, '').trim();
                
                // Sometimes Asian site adds "<ของฮิบิกิ>" directly.
                // We'll leave the Thai name as is since it's the official name.
                
                // Get English and Rarity from JA DB mapping
                let engName = null;
                let rarity = null;
                let ref = jaMap[number];
                if (ref) {
                    // if engName in DB is null, we can fallback to romaji or fetch from string map
                    engName = ref.english_name;
                    rarity = ref.rarity;
                }
                
                // Hardcode some CRZ names or rarities if needed, but the user says to use DB.
                results.push({
                    id: `S12a-${number}-TH`,
                    set_id: "S12a",
                    language: "th",
                    number: number,
                    name: thaiName,
                    english_name: engName,
                    rarity: rarity,
                });
            } else {
                console.log("Failed to parse", dUrl);
            }
        } catch (e) {
            console.error(`Error on ${dUrl}:`, e.message);
        }
    }
    
    console.log("Scraping complete. Upserting to Supabase...");
    let successCount = 0;
    for(let i=0; i<results.length; i+=50) {
        let chunk = results.slice(i, i+50);
        let { error } = await supabase.from('pokemon_cards').upsert(chunk);
        if (error) {
            console.error("Upsert error:", error);
        } else {
            successCount += chunk.length;
        }
    }
    console.log(`Successfully updated ${successCount} cards in S12a!`);
}

scrape();
