/**
 * Backfill pokemon_cards.english_name for Thai rows from their Japanese twin.
 *
 * Thai sets reprint a Japanese set 1:1 with identical numbering, so the Pokemon at
 * th <set>/<number> is the same as ja <set>/<number>. Where the catalog holds the
 * JA twin under the same set code, we can copy ja.english_name -> th.english_name
 * deterministically (no cross-language name guessing). This is the ONLY safe source:
 * the EN twin renumbers, so an EN number-match would mislabel cards. (The set_bridge
 * in scripts/build_set_bridge.ts maps Thai->EN for PRICING, not names.)
 *
 *   node scripts/backfill-thai-english-name.mjs            # dry-run (auto-detects JP-bridgeable sets)
 *   node scripts/backfill-thai-english-name.mjs --commit   # write
 *
 * Idempotent (only fills rows where english_name is null/empty). Reversible per set:
 *   UPDATE pokemon_cards SET english_name = NULL
 *   WHERE language='th' AND set_id IN (...) AND english_name IS NOT NULL;
 *
 * pHash guard: the 1:1-numbering premise is NOT universal — TH and JA products can
 * share a set code yet be renumbered (SVK: the JA rows are Deck Build BOX Stella
 * Miracle, the TH rows a different lineup — a blind number-match mislabeled 22/27
 * rows, e.g. Mew ex as "Radiant Charizard"; fixed 2026-07-03). Since a Thai reprint
 * keeps the same artwork, each pair is verified by pHash distance when both sides
 * are hashed: pairs > MAX_TWIN_DIST bits are skipped, and if over SET_MISMATCH_FRAC
 * of a set's hashed pairs mismatch, the whole set is skipped (numbering broken).
 */
import { getSupabase } from './lib/thai-catalog.mjs';

const COMMIT = process.argv.includes('--commit');
const sb = getSupabase();
const norm = n => (n || '').split('/')[0].trim();

// True reprint pairs land at ~6-13 bits. 14 (not 20) because ITEM/TRAINER cards
// share near-identical layouts and false-match in the 14-20 band — SVK had Rare
// Candy pass as "Nest Ball" at <=20. A rare true pair above 14 (worn AS-era scans)
// just gets skipped, which only costs a fill.
const MAX_TWIN_DIST = 14;
const SET_MISMATCH_FRAC = 0.3;  // more than this => the set's numbering premise is broken

const hexToBytes = h => {
  const s = h.startsWith('\\x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};
const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) POP[i] = (i & 1) + POP[i >> 1];
const phashDist = (aHex, bHex) => {
  if (!aHex || !bHex) return null;
  const a = hexToBytes(aHex), b = hexToBytes(bHex);
  if (a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[a[i] ^ b[i]];
  return d;
};

// Find th sets with english_name gaps
const gap = new Map();
let from = 0; const P = 1000;
for (;;) {
  const { data, error } = await sb.from('pokemon_cards')
    .select('id,set_id,number,english_name,phash').eq('language', 'th').order('id').range(from, from + P - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data.length) break;
  for (const r of data) {
    if (r.english_name && r.english_name.trim()) continue;
    const s = gap.get(r.set_id) || []; s.push(r); gap.set(r.set_id, s);
  }
  from += P; if (data.length < P) break;
}

const updates = [];
const perSet = [];
for (const [setId, rows] of gap) {
  // Look up JA twin under the same set code
  const { data: ja } = await sb.from('pokemon_cards')
    .select('number,english_name,phash').ilike('set_id', setId).eq('language', 'ja');
  if (!ja || !ja.length) continue;
  const jaMap = new Map();
  for (const r of ja) { const n = norm(r.number); if (r.english_name && r.english_name.trim() && !jaMap.has(n)) jaMap.set(n, { name: r.english_name.trim(), phash: r.phash }); }

  // Verify the 1:1-numbering premise on the hashed pairs before trusting any of it.
  let hashed = 0, mismatched = 0;
  for (const r of rows) {
    const twin = jaMap.get(norm(r.number));
    const d = twin ? phashDist(r.phash, twin.phash) : null;
    if (d == null) continue;
    hashed++;
    if (d > MAX_TWIN_DIST) mismatched++;
  }
  if (hashed && mismatched / hashed > SET_MISMATCH_FRAC) {
    console.warn(`  !! ${setId}: ${mismatched}/${hashed} hashed pairs fail pHash — numbering premise broken, SKIPPING set`);
    continue;
  }

  let filled = 0, skipped = 0;
  for (const r of rows) {
    const twin = jaMap.get(norm(r.number));
    if (!twin) continue;
    const d = phashDist(r.phash, twin.phash);
    if (d != null && d > MAX_TWIN_DIST) { skipped++; continue; } // different art => not the same card
    updates.push({ id: r.id, english_name: twin.name }); filled++;
  }
  if (filled || skipped) perSet.push({ setId, filled, skipped, gap: rows.length, samples: rows.slice(0, 2).map(r => `${r.number}->${jaMap.get(norm(r.number))?.name || '-'}`) });
}

console.log('Per-set fills (via JA twin number-match, pHash-verified):');
for (const p of perSet) console.log(`  ${p.setId.padEnd(8)} ${p.filled}/${p.gap} (${p.skipped} pHash-skipped)   e.g. ${p.samples.join(', ')}`);
console.log(`\nTotal rows to fill: ${updates.length}`);

if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit to write.'); process.exit(0); }

let written = 0;
for (const u of updates) {
  const { error } = await sb.from('pokemon_cards').update({ english_name: u.english_name }).eq('id', u.id);
  if (error) { console.error('update failed', u.id, error.message); process.exit(1); }
  written++;
  if (written % 100 === 0) console.log(`  ...${written}`);
}
console.log(`\nCommitted ${written} english_name backfills.`);
