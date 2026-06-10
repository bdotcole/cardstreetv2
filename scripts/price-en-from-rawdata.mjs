/**
 * Populate market_values (USD) for English sets from raw_data.tcgplayer prices.
 *
 * Some English sets (e.g. me03 Perfect Order, me04 Chaos Rising) were ingested
 * from TCGdex with embedded TCGplayer prices but never priced via JustTCG, so
 * they have no market_values rows. cardMapper can't read TCGdex's price shape
 * (tcgplayer.<printing>.marketPrice) — it only handles the pokemontcg.io shape
 * (tcgplayer.prices.<printing>.market) — so these prices stay invisible.
 *
 * This reads the TCGdex shape and writes one USD market_value per card, matching
 * how me02.5 is stored (so downstream Thai derivation in apply-ma4.mjs works).
 *
 *   node scripts/price-en-from-rawdata.mjs me03,me04            # dry-run
 *   node scripts/price-en-from-rawdata.mjs me03,me04 --commit    # write
 *
 * Printing preference mirrors cardMapper: holofoil, then normal, then first.
 * Price field: marketPrice, then midPrice, then lowPrice. Idempotent (upsert on
 * card_id,language,condition). Reversible by set_id.
 */

import { getSupabase } from './lib/thai-catalog.mjs';

const COMMIT = process.argv.includes('--commit');
const sets = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
if (!sets.length) { console.error('Usage: node scripts/price-en-from-rawdata.mjs <set1,set2> [--commit]'); process.exit(1); }

function priceFromTcgplayer(tp) {
  if (!tp) return null;
  // TCGdex shape: tcgplayer = { unit, updated, normal:{marketPrice,...}, holofoil:{...}, 'reverse-holofoil':{...} }
  const printing = tp.holofoil || tp.normal || tp['reverse-holofoil']
    || Object.values(tp).find(v => v && typeof v === 'object' && ('marketPrice' in v || 'midPrice' in v || 'lowPrice' in v));
  if (!printing) return null;
  const p = printing.marketPrice ?? printing.midPrice ?? printing.lowPrice;
  return (typeof p === 'number' && p > 0) ? p : null;
}

const supabase = getSupabase();
const rows = [];
let scanned = 0, noPrice = 0;
for (const set of sets) {
  const { data, error } = await supabase
    .from('pokemon_cards').select('id,number,name,raw_data->tcgplayer')
    .eq('set_id', set).eq('language', 'en');
  if (error) { console.error(error.message); process.exit(1); }
  for (const c of data || []) {
    scanned++;
    const usd = priceFromTcgplayer(c.tcgplayer);
    if (usd == null) { noPrice++; continue; }
    rows.push({
      card_id: c.id, language: 'en', condition: 'Raw_NM', printing: null,
      market_avg: usd, currency: 'USD', game: 'pokemon',
      source_links: ['TCGdex raw_data (TCGplayer)'],
      last_updated: new Date().toISOString(),
    });
  }
  console.log(`${set}: scanned ${data.length}, priced ${data.length - noPrice}`);
}
console.log(`\nTotal: ${scanned} scanned, ${rows.length} priced, ${noPrice} no usable price`);
console.log('Samples:'); rows.slice(0, 6).forEach(r => console.log(`  ${r.card_id} -> $${r.market_avg}`));

if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit to write.'); process.exit(0); }

let written = 0;
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabase.from('market_values').upsert(rows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
  if (error) { console.error('upsert failed:', error.message); process.exit(1); }
  written += rows.slice(i, i + 500).length;
}
console.log(`\nCommitted ${written} en market_values. Rollback: DELETE FROM market_values WHERE card_id LIKE 'me03-%' OR card_id LIKE 'me04-%' (language='en');`);
