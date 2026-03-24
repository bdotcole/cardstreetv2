/**
 * fix-price-english.mjs
 * Runs the JustTCG pricing logic for specific broken English sets locally.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY || '';
const JUSTTCG_BASE = 'https://api.justtcg.com/v1';

const TARGET_SETS = {
  'me02.5': 'me-ascended-heroes-pokemon',
  'me02': 'me-pokemon-trading-card-game-classic-pokemon',
  'me01': 'me-genetic-apex-pokemon'
};

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function jtcgFetch(path) {
  const r = await fetch(`${JUSTTCG_BASE}${path}`, {
    headers: { 'x-api-key': JUSTTCG_API_KEY, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`JustTCG ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log('=== KICKING OFF LOCAL ENGLISH PRICING ===');

  for (const [dbSetId, jtcgId] of Object.entries(TARGET_SETS)) {
    try {
      console.log(`\nFetching JustTCG set: ${jtcgId}...`);
      
      let allJtcgCards = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const resp = await jtcgFetch(`/cards?game=pokemon&set=${encodeURIComponent(jtcgId)}&conditions=NM&include_price_history=false&limit=${limit}&offset=${offset}`);
        const page = resp.data ?? [];
        allJtcgCards = allJtcgCards.concat(page);
        if (!resp.meta?.hasMore || page.length < limit) break;
        offset += limit;
        await new Promise(r => setTimeout(r, 1000));
      }

      const jtcgCards = allJtcgCards.filter(c => c.number && c.number !== 'N/A');
      console.log(`Found ${jtcgCards.length} singles for ${jtcgId}.`);

      const { data: dbCards } = await supabase.from('pokemon_cards').select('id, name, number').eq('set_id', dbSetId).eq('language', 'en');
      
      const byNumber = new Map((dbCards ?? []).map(c => [String(c.number), c]));
      const byName = new Map((dbCards ?? []).map(c => [norm(c.name), c]));

      const rows = [];
      for (const jCard of jtcgCards) {
        const rawNum = jCard.number?.toString() ?? '';
        const strippedNum = rawNum.includes('/') ? rawNum.split('/')[0] : rawNum;
        const strippedNumNoZeros = strippedNum.replace(/^0+/, '');

        const dbCard = byNumber.get(strippedNum) ?? byNumber.get(strippedNumNoZeros) ?? byName.get(norm(jCard.name ?? ''));
        if (!dbCard) continue;

        // FIXED SORTING LOGIC: Prioritize avgPrice > 0, ignore cheap troll listings
        const enVariants = (jCard.variants ?? []).filter(v => v.language === 'English' || !v.language);
        const sortedVariants = enVariants.sort((a, b) => {
          let scoreA = 0;
          let scoreB = 0;
          if (a.avgPrice > 0) scoreA += 1000;
          if (b.avgPrice > 0) scoreB += 1000;
          if (a.condition === 'Near Mint' || a.condition === 'NM') scoreA += 500;
          else if (a.condition === 'Lightly Played' || a.condition === 'LP') scoreA += 200;
          if (b.condition === 'Near Mint' || b.condition === 'NM') scoreB += 500;
          else if (b.condition === 'Lightly Played' || b.condition === 'LP') scoreB += 200;
          if (a.printing === 'Holofoil') scoreA += 100;
          else if (a.printing === 'Reverse Holofoil') scoreA += 50;
          if (b.printing === 'Holofoil') scoreB += 100;
          else if (b.printing === 'Reverse Holofoil') scoreB += 50;

          if (scoreA === scoreB && a.avgPrice === 0 && b.avgPrice === 0) {
              return (b.price || 0) - (a.price || 0); // Flipped sorting: prioritize highest listing to ignore $10 trolls if no sales
          }
          return scoreB - scoreA;
        });

        const bestVariant = sortedVariants[0] ?? (jCard.variants ?? [])[0];
        const price = bestVariant?.avgPrice || bestVariant?.price || 0;
        if (price <= 0) continue;
        
        // Custom debug log for Mega Dragonite ex
        if (dbCard.name.includes("Mega Dragonite ex")) {
           console.log(`  -> Detected Mega Dragonite ex: Pricing at $${price}`);
        }

        rows.push({
          card_id: dbCard.id,
          language: 'en',
          condition: 'Raw_NM',
          market_avg: price,
          source_links: [`https://justtcg.com/card/${jCard.id}`],
          source_prices: {
            market_price: price,
            low_price: bestVariant?.minPrice30d ?? 0,
            high_price: bestVariant?.maxPrice30d ?? 0,
            source: 'justtcg',
          },
          currency: 'USD',
          last_updated: new Date().toISOString(),
          last_priced_at: new Date().toISOString(),
        });
      }

      if (rows.length > 0) {
        let i = 0; 
        const B = 500;
        while(i < rows.length) {
           const b = rows.slice(i, i+B);
           // MUST use Map to dedup by card_id
           const dedup = Array.from(new Map(b.map(r => [r.card_id, r])).values());
           const { error } = await supabase.from('market_values').upsert(dedup, { onConflict: 'card_id,language,condition' });
           if (error) console.error("  error upserting:", error.message);
           i += B;
        }
      }
      console.log(`  ✓ Inserted ${rows.length} EN prices for ${dbSetId}`);

    } catch (e) {
      console.error(`Error processing ${dbSetId}:`, e.message);
    }
  }
}
main();
