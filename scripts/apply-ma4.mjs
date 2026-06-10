/**
 * MA4 (วอยด์บลาสต์ / Void Blast) completion.
 *
 * MA4 cards were ingested (181 rows) but have placeholder set name, null
 * english_name/rarity, and no price. Unlike MA1/MA2 there is no single English
 * twin set: MA4 cards are spread across me02.5 / me03 / me01 / me02 / me04 and
 * the international sets renumber, so number-based matching is wrong. We match
 * each Thai card to its English counterpart by pHash (same artwork across
 * languages — the scanner's method), which gives the correct card regardless of
 * set/number.
 *
 *   node scripts/apply-ma4.mjs            # dry-run: print plan + write review CSV
 *   node scripts/apply-ma4.mjs --commit   # write to prod
 *
 * Writes: pokemon_sets.name (MA4 -> วอยด์บลาสต์), pokemon_cards.english_name +
 * rarity (confident matches), card_mappings, and market_values (THB, only where
 * the English source is priced). Reversible:
 *   DELETE FROM market_values WHERE card_id LIKE 'MA4-%-th';
 *   DELETE FROM card_mappings WHERE card_id_th LIKE 'MA4-%-th';
 */

import fs from 'fs';
import path from 'path';
import { getSupabase, ROOT } from './lib/thai-catalog.mjs';

const COMMIT = process.argv.includes('--commit');
const DIST_MAX = 13;          // confident pHash band (verified clean by name)
const EN_MULT = 0.55;         // EN->TH market multiplier (matches MA1/MA2 stored data)
const USD_THB = 35.85;        // USD->THB (matches existing th market_values, ratio 19.72)
const FLOOR_THB = 10;
const SET_NAME_TH = 'วอยด์บลาสต์';
const EN_SETS = ['me01', 'me02', 'me02.5', 'me03', 'me04'];

const toBig = (hex) => BigInt('0x' + String(hex).replace(/[^0-9a-fA-F]/g, ''));
const ham = (a, b) => { let x = a ^ b, c = 0n; while (x) { c += x & 1n; x >>= 1n; } return Number(c); };

// English rarity string -> Thai display code (matches THAI_RARITY_DISPLAY in lib/cardMapper.ts).
const RARITY_TH = {
  'common': 'C', 'uncommon': 'U', 'rare': 'R', 'double rare': 'RR',
  'ultra rare': 'SR', 'illustration rare': 'AR', 'special illustration rare': 'SAR',
  'hyper rare': 'UR', 'shiny rare': 'AR', 'shiny ultra rare': 'UR',
};
function rarityToThai(en) {
  if (!en) return null;
  const k = en.toLowerCase().trim();
  return RARITY_TH[k] || en; // pass through codes / unknowns; cardMapper normalizes at display
}

const supabase = getSupabase();

// 1. English pool: phash + price (one USD market_value per card)
let pool = [];
for (const set of EN_SETS) {
  const { data } = await supabase
    .from('pokemon_cards').select('id,set_id,number,name,rarity,phash')
    .eq('set_id', set).eq('language', 'en');
  pool = pool.concat((data || []).filter(c => c.phash));
}
const poolIds = pool.map(c => c.id);
// English sources are priced in mixed currencies: me02.5 in USD, me01/me02 in THB
// (English market already converted to THB). Prefer the THB row when both exist.
const priceById = new Map(); // id -> { avg, currency }
for (let i = 0; i < poolIds.length; i += 300) {
  const { data } = await supabase.from('market_values')
    .select('card_id,market_avg,currency').in('card_id', poolIds.slice(i, i + 300));
  for (const m of (data || [])) {
    if (m.market_avg > 0 && (m.currency === 'USD' || m.currency === 'THB')) {
      const prev = priceById.get(m.card_id);
      if (!prev || (m.currency === 'THB' && prev.currency !== 'THB')) priceById.set(m.card_id, { avg: m.market_avg, currency: m.currency });
    }
  }
}
const enH = pool.map(c => ({ ...c, h: toBig(c.phash) }));
console.log(`EN pool: ${pool.length} cards, ${priceById.size} priced`);

// English source price (any currency) -> Thai THB value (haircut applied; matches MA1/MA2).
function thaiPriceFromEn(p) {
  const thb = p.currency === 'USD' ? p.avg * EN_MULT * USD_THB : p.avg * EN_MULT;
  return Math.max(FLOOR_THB, +thb.toFixed(2));
}

// 2. MA4 cards -> nearest EN by pHash
const { data: ma4 } = await supabase
  .from('pokemon_cards').select('id,number,name,phash,english_name,rarity')
  .eq('set_id', 'MA4').eq('language', 'th').order('number');

const cardUpdates = [], mappings = [], marketRows = [], review = [];
let priced = 0, enriched = 0, skipped = 0;

for (const c of ma4) {
  if (!c.phash) { skipped++; review.push([c.number, c.name, 'NO_PHASH', '', '']); continue; }
  const h = toBig(c.phash); let best = null, bd = 999;
  for (const e of enH) { const d = ham(h, e.h); if (d < bd) { bd = d; best = e; } }
  if (bd > DIST_MAX) { skipped++; review.push([c.number, c.name, `SKIP d=${bd}`, best.set_id + '#' + best.number, best.name]); continue; }

  enriched++;
  const thaiRarity = rarityToThai(best.rarity);
  cardUpdates.push({ id: c.id, english_name: best.name, rarity: thaiRarity });
  mappings.push({
    card_id_th: c.id, card_id_en: best.id,
    match_method: 'phash', confidence_score: Math.min(1, +(1 - bd / 64).toFixed(2)), verified: false,
  });

  const enPrice = priceById.get(best.id);
  let priceNote = 'unpriced(' + best.set_id + ')';
  if (enPrice) {
    const thb = thaiPriceFromEn(enPrice);
    marketRows.push({
      card_id: c.id, language: 'th', condition: 'Raw_NM', printing: null,
      market_avg: thb, currency: 'THB', game: 'pokemon',
      source_links: [`Database English Match (pHash ${best.set_id})`],
      source_prices: { en_card: best.id, en_price: enPrice.avg, en_currency: enPrice.currency, mult: EN_MULT, usd_thb: USD_THB, phash_dist: bd },
      last_updated: new Date().toISOString(),
    });
    priced++; priceNote = `${thb} THB (en ${enPrice.avg}${enPrice.currency})`;
  }
  review.push([c.number, c.name, `d=${bd}`, best.set_id + '#' + best.number + ' ' + best.name, priceNote]);
}

console.log(`\nMA4 plan: ${enriched} enriched+mapped (d<=${DIST_MAX}), ${priced} priced now, ${skipped} skipped (d>${DIST_MAX} -> manual review)`);
console.log(`unpriced confident matches (await me03/me04 ingest): ${enriched - priced}`);

// review CSV
const outDir = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(outDir, { recursive: true });
const csv = 'th_number,th_name,phash,en_match,price\n' +
  review.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
fs.writeFileSync(path.join(outDir, 'ma4-match-review.csv'), csv);
console.log(`review written: scripts/out/ma4-match-review.csv`);

if (!COMMIT) {
  console.log('\nDRY-RUN. Sample priced rows:');
  for (const r of marketRows.slice(0, 6)) console.log(`  ${r.card_id} -> ${r.market_avg} THB`);
  console.log('\nRe-run with --commit to write.');
  process.exit(0);
}

// 3. COMMIT
console.log('\nCommitting...');
{
  const { error } = await supabase.from('pokemon_sets').update({ name: SET_NAME_TH }).eq('id', 'MA4');
  if (error) { console.error('set name update failed:', error.message); process.exit(1); }
  console.log(`set name -> ${SET_NAME_TH}`);
}
// per-row card updates (upsert would null unspecified columns, so use update())
let cu = 0;
for (let i = 0; i < cardUpdates.length; i += 20) {
  await Promise.all(cardUpdates.slice(i, i + 20).map(u =>
    supabase.from('pokemon_cards').update({ english_name: u.english_name, rarity: u.rarity }).eq('id', u.id)
      .then(({ error }) => { if (error) throw new Error(`card ${u.id}: ${error.message}`); cu++; })
  ));
}
console.log(`cards enriched (english_name+rarity): ${cu}`);

for (let i = 0; i < mappings.length; i += 500) {
  const { error } = await supabase.from('card_mappings').upsert(mappings.slice(i, i + 500), { onConflict: 'card_id_th' });
  if (error) { console.error('card_mappings upsert failed:', error.message); process.exit(1); }
}
console.log(`card_mappings upserted: ${mappings.length}`);

for (let i = 0; i < marketRows.length; i += 500) {
  const { error } = await supabase.from('market_values').upsert(marketRows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
  if (error) { console.error('market_values upsert failed:', error.message); process.exit(1); }
}
console.log(`market_values upserted: ${marketRows.length}`);
console.log('\nDone. Rollback: DELETE FROM market_values WHERE card_id LIKE \'MA4-%-th\'; DELETE FROM card_mappings WHERE card_id_th LIKE \'MA4-%-th\';');
