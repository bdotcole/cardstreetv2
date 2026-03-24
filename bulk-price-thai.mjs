/**
 * bulk-price-thai.mjs
 * Computes and inserts market pricing for all mapped Thai cards based on
 * their corresponding English counterparts. Pricing logic: EN_USD * 35.85 * 0.6
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const USD_TO_THB = 35.85;
const MULTIPLIER = 0.6;

async function fetchAll(query) {
  let allData = [];
  let from = 0;
  const size = 1000;
  
  while (true) {
    const { data, error } = await query.range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < size) break;
    from += size;
  }
  return allData;
}

async function main() {
  console.log('=== BULK PRICING THAI CARDS ===\n');

  // Fetch ALL active mappings
  let mappings = [];
  try {
    mappings = await fetchAll(supabase.from('card_mappings').select('card_id_th, card_id_en'));
    console.log(`Loaded ${mappings.length} mappings.`);
  } catch (mapErr) {
    console.error("Failed to load mappings:", mapErr);
    return;
  }

  // Extract unique English card IDs we need prices for
  const uniqueEnIds = [...new Set(mappings.map(m => m.card_id_en))];

  // Fetch required EN prices in batches to avoid URL length limits on .in()
  const enPriceMap = new Map();
  const CHUNK_SIZE = 200;
  
  console.log(`Fetching EN market values for ${uniqueEnIds.length} unique cards...`);
  for (let i = 0; i < uniqueEnIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueEnIds.slice(i, i + CHUNK_SIZE);
    const { data: chunkPrices, error: priceErr } = await supabase
      .from('market_values')
      .select('card_id, market_avg, source_prices')
      .eq('language', 'en')
      .in('card_id', chunk);

    if (priceErr) {
      console.error(`Failed to load chunk at ${i}:`, priceErr);
      continue;
    }
    
    chunkPrices?.forEach(p => enPriceMap.set(p.card_id, p));
  }

  console.log(`Loaded ${enPriceMap.size} EN prices for mapped cards.`);

  const toUpsert = [];
  let noPriceCount = 0;

  for (const m of mappings) {
    const enPrice = enPriceMap.get(m.card_id_en);
    if (!enPrice || enPrice.market_avg <= 0) {
      noPriceCount++;
      continue;
    }

    const calculatedThb = Math.floor(enPrice.market_avg * USD_TO_THB * MULTIPLIER);

    toUpsert.push({
      card_id: m.card_id_th,
      language: 'th',
      condition: 'Raw_NM',
      market_avg: calculatedThb,
      source_prices: {
        en_market_avg_usd: enPrice.market_avg,
        multiplier: MULTIPLIER,
        exchange_rate: USD_TO_THB,
        converted_thb: calculatedThb,
      },
      currency: 'THB',
      last_updated: new Date().toISOString(),
    });
  }

  console.log(`Calculated THB prices for ${toUpsert.length} Thai cards. (${(noPriceCount/mappings.length*100).toFixed(1)}% missing EN price active in db)`);

  // Batch Upsert back to database
  const UPSERT_BATCH = 500;
  for (let i = 0; i < toUpsert.length; i += UPSERT_BATCH) {
    const batch = toUpsert.slice(i, i + UPSERT_BATCH);
    const { error: upsertErr } = await supabase.from('market_values').upsert(batch, { onConflict: 'card_id,language,condition' });
    if (upsertErr) {
      console.error(`Error upserting batch ${i}:`, upsertErr);
    } else {
      console.log(`✓ Upserted batch ${Math.floor(i/UPSERT_BATCH) + 1}/${Math.ceil(toUpsert.length/UPSERT_BATCH)}`);
    }
  }

  console.log('\n=== COMPLETE ===');
}
main();
