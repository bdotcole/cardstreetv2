/**
 * Enrich a Thai Mega-era set (MA-series) by pHash-matching each Thai card to its
 * English counterpart in the international Mega pool (me01..me04). The intl sets
 * renumber, so number-based matching is wrong; pHash (same artwork across
 * languages — the scanner's method) gives the correct card regardless of
 * set/number. Generalized from the original MA4 completion script.
 *
 *   node scripts/apply-mega-thai.mjs MA5                 # dry-run: plan + review CSV
 *   node scripts/apply-mega-thai.mjs MA5 --commit        # write to prod
 *   node scripts/apply-mega-thai.mjs MA5 --name="เงามืดคุกคาม" --commit  # also set the Thai set name
 *
 * CAUTION — always review scripts/out/<code>-match-review.csv before --commit.
 * The 64-bit dHash is coarse and finds spurious nearest-neighbours when a Thai
 * card has no true counterpart in the EN pool (e.g. MA5 on 2026-06-19 produced
 * false positives even at d<=8, like Fennekin -> Ninetales). It is reliable only
 * when the Thai set is ~1:1 with the pool AND the matched name is consistent.
 *
 * Writes: pokemon_cards.english_name + rarity (confident matches), card_mappings,
 * market_values (THB, where the English source is priced), and optionally
 * pokemon_sets.name. Reversible:
 *   DELETE FROM market_values WHERE card_id LIKE '<CODE>-%-th';
 *   DELETE FROM card_mappings WHERE card_id_th LIKE '<CODE>-%-th';
 */

import fs from 'fs';
import path from 'path';
import { getSupabase, ROOT } from './lib/thai-catalog.mjs';

const args = process.argv.slice(2);
const CODE = args.find((a) => !a.startsWith('--'));
const COMMIT = args.includes('--commit');
const nameArg = args.find((a) => a.startsWith('--name='));
const SET_NAME_TH = nameArg ? nameArg.slice('--name='.length) : null;

if (!CODE) {
  console.error('Usage: node scripts/apply-mega-thai.mjs <CODE> [--name="ชื่อชุด"] [--commit]');
  process.exit(1);
}

const DIST_MAX = 13;          // confident pHash band (verified clean by name on MA4)
const EN_MULT = 0.55;         // EN->TH market multiplier (matches MA1/MA2 stored data)
const USD_THB = 35.85;        // USD->THB (matches existing th market_values, ratio 19.72)
const FLOOR_THB = 10;
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
  return RARITY_TH[en.toLowerCase().trim()] || en;
}

const supabase = getSupabase();

// 1. English pool: phash + price
let pool = [];
for (const set of EN_SETS) {
  const { data } = await supabase
    .from('pokemon_cards').select('id,set_id,number,name,rarity,phash')
    .eq('set_id', set).eq('language', 'en');
  pool = pool.concat((data || []).filter((c) => c.phash));
}
const poolIds = pool.map((c) => c.id);
// me02.5 is USD; me01/me02 store THB; me03/me04 USD. Prefer THB when both exist.
const priceById = new Map();
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
const enH = pool.map((c) => ({ ...c, h: toBig(c.phash) }));
console.log(`EN pool: ${pool.length} cards, ${priceById.size} priced`);

function thaiPriceFromEn(p) {
  const thb = p.currency === 'USD' ? p.avg * EN_MULT * USD_THB : p.avg * EN_MULT;
  return Math.max(FLOOR_THB, +thb.toFixed(2));
}

// 2. Thai set cards -> nearest EN by pHash
const { data: thai } = await supabase
  .from('pokemon_cards').select('id,number,name,phash,english_name,rarity')
  .eq('set_id', CODE).eq('language', 'th').order('number');

const cardUpdates = [], mappings = [], marketRows = [], review = [];
let priced = 0, enriched = 0, skipped = 0;

for (const c of thai) {
  if (!c.phash) { skipped++; review.push([c.number, c.name, 'NO_PHASH', '', '']); continue; }
  const h = toBig(c.phash); let best = null, bd = 999;
  for (const e of enH) { const d = ham(h, e.h); if (d < bd) { bd = d; best = e; } }
  if (bd > DIST_MAX) { skipped++; review.push([c.number, c.name, `SKIP d=${bd}`, best.set_id + '#' + best.number, best.name]); continue; }

  enriched++;
  cardUpdates.push({ id: c.id, english_name: best.name, rarity: rarityToThai(best.rarity) });
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

console.log(`\n${CODE} plan: ${enriched} enriched+mapped (d<=${DIST_MAX}), ${priced} priced now, ${skipped} skipped (d>${DIST_MAX} -> manual review)`);
console.log(`unpriced confident matches: ${enriched - priced}`);

const outDir = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(outDir, { recursive: true });
const csv = 'th_number,th_name,phash,en_match,price\n' +
  review.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
const csvPath = path.join(outDir, `${CODE.toLowerCase()}-match-review.csv`);
fs.writeFileSync(csvPath, csv);
console.log(`review written: ${path.relative(ROOT, csvPath)}`);

if (!COMMIT) {
  console.log('\nDRY-RUN. Sample priced rows:');
  for (const r of marketRows.slice(0, 6)) console.log(`  ${r.card_id} -> ${r.market_avg} THB`);
  console.log('\nRe-run with --commit to write.');
  process.exit(0);
}

// 3. COMMIT
console.log('\nCommitting...');
if (SET_NAME_TH) {
  const { error } = await supabase.from('pokemon_sets').update({ name: SET_NAME_TH }).eq('id', CODE);
  if (error) { console.error('set name update failed:', error.message); process.exit(1); }
  console.log(`set name -> ${SET_NAME_TH}`);
}
let cu = 0;
for (let i = 0; i < cardUpdates.length; i += 20) {
  await Promise.all(cardUpdates.slice(i, i + 20).map((u) =>
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
console.log(`\nDone. Rollback: DELETE FROM market_values WHERE card_id LIKE '${CODE}-%-th'; DELETE FROM card_mappings WHERE card_id_th LIKE '${CODE}-%-th';`);
