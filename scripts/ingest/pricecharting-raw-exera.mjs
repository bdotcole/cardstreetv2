/**
 * Raw (ungraded) prices for the vintage EX-era English Pokemon sets, from
 * PriceCharting's bulk price guide.
 *
 *   node scripts/ingest/pricecharting-raw-exera.mjs            # dry run (default)
 *   node scripts/ingest/pricecharting-raw-exera.mjs --commit    # write
 *   node scripts/ingest/pricecharting-raw-exera.mjs --sets=ex2,ex9 --commit
 *
 * Why PriceCharting and not the usual JustTCG path: JustTCG indexes these sets
 * (its /sets endpoint reports ~102 cards for `ex-sandstorm-pokemon`) but returns
 * ZERO card records for them at every offset, with and without a condition
 * filter -- verified 2026-08-06 across ex1-ex16. It is a vendor-side gap, so no
 * amount of slug fixing reaches them, and `batch-price-english` leaves ~1,578
 * cards permanently unpriced. PriceCharting carries all of them.
 *
 * Two things make this different from the sibling graded ingest
 * (scripts/ingest/pricecharting.mjs), which deliberately does NOT store raw:
 *   - it reads `loose-price` (ungraded) and writes condition 'Raw_NM', the row
 *     `pickDisplayMarketValue` actually shows, rather than the PSA/BGS columns;
 *   - PriceCharting names these consoles WITHOUT the "EX" prefix our set names
 *     carry ("Pokemon Sandstorm", not "EX Sandstorm"), so the console map below
 *     is explicit rather than normalize-matched.
 *
 * Safety: admin pins and realized-sale rows are protected by the
 * guard_market_value_source trigger (it reverts market_avg when the existing
 * row's source is 'admin'/'cardstreet'), and this script additionally skips
 * them so it never issues a pointless write.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const COMMIT = process.argv.includes('--commit');
const setsArg = (process.argv.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '');

// --- env (.env.local), stripping surrounding quotes per CLAUDE.md gotcha -------
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[line.slice(0, i).trim()] = v;
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const TOKEN = (env.PRICECHARTING_TOKEN || '').trim();
if (!TOKEN) { console.error('PRICECHARTING_TOKEN missing from .env.local'); process.exit(1); }

// our set_id -> EXACT PriceCharting console-name. Verified against the live CSV
// 2026-08-06; every one matched 100% of our cards by collector number.
const CONSOLE_BY_SET = {
  ex1:  'Pokemon Ruby & Sapphire',
  ex2:  'Pokemon Sandstorm',
  ex3:  'Pokemon Dragon',
  ex4:  'Pokemon Team Magma & Team Aqua',
  ex5:  'Pokemon Hidden Legends',
  ex6:  'Pokemon Fire Red & Leaf Green',   // note the spaces; not "FireRed & LeafGreen"
  ex7:  'Pokemon Team Rocket Returns',
  ex8:  'Pokemon Deoxys',
  ex9:  'Pokemon Emerald',
  ex10: 'Pokemon Unseen Forces',
  ex11: 'Pokemon Delta Species',
  ex12: 'Pokemon Legend Maker',
  ex13: 'Pokemon Holon Phantoms',
  ex14: 'Pokemon Crystal Guardians',
  ex15: 'Pokemon Dragon Frontiers',
  ex16: 'Pokemon Power Keepers',
  // The Unown Collection ships inside the Unseen Forces console rather than
  // getting its own. Its cards are keyed by LETTER, not a "#123" number, so it
  // needs the special matcher below.
  exu:  'Pokemon Unseen Forces',
};

// exu (Unseen Forces Unown Collection): our `number` is the bare letter
// ("A".."Z", "!", "?") while PriceCharting writes "Unown [A]" / "Unown
// [Exclamation]" / "Unown [Question]". No "#" appears at all, so the generic
// number regex finds nothing and the set would silently match 0 cards.
const UNOWN_LABEL_BY_NUMBER = { '!': 'exclamation', '?': 'question' };
function unownKeyFromProductName(productName) {
  const m = String(productName).match(/^unown\s*\[([^\]]+)\]/i);
  return m ? m[1].trim().toLowerCase() : null;
}
function unownKeyFromOurNumber(number) {
  const n = String(number).trim();
  return (UNOWN_LABEL_BY_NUMBER[n] || n).toLowerCase();
}

// A set whose numbering does not line up with ours must be skipped wholesale
// rather than written card-by-card: PriceCharting numbers some vintage sets on a
// different scheme, and a number-match there produces random pairings (a $61k
// Shining Charizard once landed on a no-name filler). Names must corroborate.
const NAME_AGREEMENT_MIN = 0.9;

const BASE = 'https://www.pricecharting.com';

// ── CSV parser (quoted fields + embedded commas) -- mirrors pricecharting.mjs ──
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The bulk CSV formats prices as dollar strings ("$1,234.50"), NOT the integer
// cents the JSON product API returns.
const usd = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Strip diacritics before comparing names: our catalog stores "Poké Ball" /
// "Pokémon Reversal" while PriceCharting writes "Poke Ball" / "Pokemon Reversal".
// Without this the agreement gate false-negatives on every accented card.
const norm = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const stripNum = (s) => String(s || '').toLowerCase().replace(/^0+(?=\d)/, '');

async function downloadCsv() {
  const res = await fetch(`${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=pokemon-cards`);
  if (!res.ok) throw new Error(`CSV download ${res.status}`);
  const rows = parseCsv(await res.text());
  const hdr = rows[0];
  const products = rows.slice(1)
    .filter((r) => r.length === hdr.length)
    .map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]])));
  // An invalid category returns HTTP 200 with the entire 122k-row video-game
  // catalog (first console "3DO"). Abort rather than ingest garbage.
  if (products[0]?.['console-name'] === '3DO') throw new Error('got the all-products fallback, not pokemon-cards');
  return products;
}

(async () => {
  console.log(`pricecharting raw ex-era ${COMMIT ? '(COMMIT)' : '(dry run -- pass --commit to write)'}`);
  const products = await downloadCsv();
  console.log(`CSV products: ${products.length}`);

  const byConsole = new Map();
  for (const p of products) {
    const c = p['console-name'];
    if (!byConsole.has(c)) byConsole.set(c, []);
    byConsole.get(c).push(p);
  }

  const targets = setsArg ? setsArg.split(',').map((s) => s.trim()) : Object.keys(CONSOLE_BY_SET);
  const allRows = [];
  const now = new Date().toISOString();
  let skippedSets = [], totalMatched = 0, totalCards = 0, protectedRows = 0;

  for (const setId of targets) {
    const consoleName = CONSOLE_BY_SET[setId];
    if (!consoleName) { console.warn(`  ${setId}: no console mapping, skipping`); continue; }
    const pcRows = byConsole.get(consoleName);
    if (!pcRows) { console.warn(`  ${setId}: console "${consoleName}" not in CSV, skipping`); skippedSets.push(setId); continue; }

    const { data: ours, error } = await supabase
      .from('pokemon_cards').select('id, number, name').eq('set_id', setId).eq('language', 'en');
    if (error) throw new Error(`cards ${setId}: ${error.message}`);

    // Existing prices: skip deliberate pins entirely.
    const { data: existing } = await supabase
      .from('market_values').select('card_id, source')
      .eq('language', 'en').eq('condition', 'Raw_NM')
      .in('card_id', (ours || []).map((c) => c.id));
    const pinned = new Set((existing || []).filter((m) => ['admin', 'cardstreet'].includes(m.source)).map((m) => m.card_id));

    // Index PriceCharting rows by collector number, preferring the BASE print:
    // "[Reverse Holo]" / "(Staff)" variants are separate collectibles at very
    // different prices and must never become the base card's price.
    const isUnownSet = setId === 'exu';
    const pcByNum = new Map();
    for (const p of pcRows) {
      let num, isVariant;
      if (isUnownSet) {
        const key = unownKeyFromProductName(p['product-name']);
        if (!key) continue;          // ordinary Unseen Forces card, not an Unown
        num = key;
        isVariant = false;           // the bracket IS the identity here
      } else {
        const m = String(p['product-name']).match(/#\s*([A-Za-z]{0,4}\d{1,4})\b/);
        if (!m) continue;
        if (unownKeyFromProductName(p['product-name'])) continue; // belongs to exu
        num = stripNum(m[1]);
        isVariant = /\[|\(/.test(p['product-name']);
      }
      const prev = pcByNum.get(num);
      if (!prev || (prev.isVariant && !isVariant)) pcByNum.set(num, { p, isVariant });
    }

    const candidates = [];
    let nameAgree = 0, matched = 0;
    for (const c of ours || []) {
      const hit = pcByNum.get(isUnownSet ? unownKeyFromOurNumber(c.number) : stripNum(c.number));
      if (!hit) continue;
      matched++;
      const pcName = norm(String(hit.p['product-name']).replace(/#.*$/, '').replace(/\[[^\]]*\]/g, ''));
      const ourName = norm(c.name);
      if (pcName === ourName || pcName.includes(ourName) || ourName.includes(pcName)) nameAgree++;

      const price = usd(hit.p['loose-price']);
      if (!price) continue;
      if (pinned.has(c.id)) { protectedRows++; continue; }
      candidates.push({
        card_id: c.id,
        language: 'en',
        condition: 'Raw_NM',
        market_avg: price,
        // currency defaults to THB at the column level -- must be explicit, or
        // every one of these USD prices renders ~36x low.
        currency: 'USD',
        game: 'pokemon',
        printing: null,
        source_links: [`${BASE}/game/${encodeURIComponent(consoleName.toLowerCase().replace(/\s+/g, '-'))}/${String(hit.p.id)}`],
        source_prices: { market_price: price, source: 'pricecharting', pricecharting_id: String(hit.p.id), console: consoleName, method: 'pc_loose' },
        last_updated: now,
        last_priced_at: now,
      });
    }

    const agree = matched ? nameAgree / matched : 0;
    totalMatched += matched; totalCards += (ours || []).length;
    if (agree < NAME_AGREEMENT_MIN) {
      console.warn(`  ${setId.padEnd(5)} SKIPPED -- name agreement ${Math.round(agree * 100)}% < ${NAME_AGREEMENT_MIN * 100}% (numbering likely differs)`);
      skippedSets.push(setId);
      continue;
    }
    console.log(`  ${setId.padEnd(5)} ${consoleName.padEnd(32)} matched ${String(matched).padStart(4)}/${String((ours || []).length).padEnd(4)} names ${String(Math.round(agree * 100)).padStart(3)}%  -> ${candidates.length} priced`);
    allRows.push(...candidates);
  }

  console.log(`\nprepared ${allRows.length} Raw_NM rows across ${targets.length - skippedSets.length} sets (matched ${totalMatched}/${totalCards} cards)`);
  if (protectedRows) console.log(`skipped ${protectedRows} rows pinned to admin/cardstreet`);
  if (skippedSets.length) console.log(`skipped sets: ${skippedSets.join(', ')}`);
  if (allRows.length) {
    const prices = allRows.map((r) => r.market_avg).sort((a, b) => a - b);
    console.log(`price range: $${prices[0]} .. $${prices[prices.length - 1]}, median $${prices[Math.floor(prices.length / 2)]}`);
  }

  if (!COMMIT) { console.log('\nDRY RUN -- nothing written.'); return; }

  for (let i = 0; i < allRows.length; i += 500) {
    const { error } = await supabase.from('market_values')
      .upsert(allRows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
    if (error) throw new Error(`upsert: ${error.message}`);
  }
  console.log(`wrote ${allRows.length} market_values rows`);
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
