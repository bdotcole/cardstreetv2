// Raw (ungraded) prices for the Yu-Gi-Oh sets JustTCG cannot reach, from
// PriceCharting's bulk price-guide CSV.
//
//   node scripts/ingest/pricecharting-raw-yugioh.mjs            # dry run
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --commit
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --sets=ygo-lob,ygo-mp25
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --all      # not just unpriced sets
//
// WHY
// ---
// `batch-price-games` resolves a JustTCG set by exact normalized NAME. 340 of our
// 636 Yu-Gi-Oh sets match no JustTCG set at all, so they were never priceable there
// (measured 2026-08-13; see the set-starvation note). Their cards fell back to the
// legacy, unmaintained 'Near Mint' tier. PriceCharting carries 59 of those sets —
// 4,254 cards, including Legend of Blue Eyes, the Mega Packs and the Legendary
// Collections. The remaining 281 (collab cards, "(POR)" Portuguese OTS packs, prize
// cards) exist on neither vendor and stay unpriced.
//
// Sibling of scripts/ingest/pricecharting-raw-exera.mjs, which did the same for the
// EX-era Pokemon gap. Like that script it reads `loose-price` (ungraded) and writes
// condition 'Raw_NM' — the row pickDisplayMarketValue actually shows — which is
// deliberately different from scripts/ingest/pricecharting.mjs (GRADED columns only).
//
// Costs exactly ONE HTTP request (the bulk CSV) no matter how many cards, so it
// sidesteps the ~1 req/s token bucket that throttles the per-product API.
//
// YU-GI-OH NUMBERING TRAPS (these differ from the Pokemon script)
// --------------------------------------------------------------
// PriceCharting names Yu-Gi-Oh cards with a TRAILING set code, not a "#123":
//     "Aqua Madoor LOB-027"                 <- North American print, our numbering
//     "Aqua Madoor LOB-E021"                <- EUROPEAN print of the SAME card
//     "Aqua Madoor [1st Edition] LOB-027"   <- variant of the NA print
// The European code carries a different number for the same card, so parsing digits
// out of "LOB-E021" would file Aqua Madoor under our #021 — a different card. Only
// codes whose number part is PURELY numeric are accepted; anything with a letter
// prefix on the number (E021, EN001, JP016) is skipped. Bracketed variants
// ([1st Edition], [Limited Edition]) lose to the base print at the same number.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}
const TOKEN = (env.PRICECHARTING_TOKEN || '').trim();
if (!TOKEN) { console.error('PRICECHARTING_TOKEN missing from .env.local'); process.exit(1); }
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BASE = 'https://www.pricecharting.com';
const COMMIT = process.argv.includes('--commit');
const ALL_SETS = process.argv.includes('--all');
const setsArg = (process.argv.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '');
const CSV_CACHE = (process.argv.find((a) => a.startsWith('--csv=')) || '').replace('--csv=', '');
// A set whose numbering disagrees with PriceCharting's is skipped wholesale rather
// than paired at random — the documented vintage mis-pairing hazard.
const NAME_AGREEMENT_MIN = 0.9;

// Diacritics must go before comparing: our catalog and PriceCharting disagree on
// accents, and without NFD the agreement gate false-negatives on every accented card.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripNum = (s) => String(s ?? '').replace(/^0+(?=\d)/, '').trim();
const usd = (s) => {
  const n = parseFloat(String(s ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

async function loadProducts() {
  if (CSV_CACHE && fs.existsSync(CSV_CACHE)) {
    console.log(`reading cached CSV ${CSV_CACHE}`);
    return parseCsv(fs.readFileSync(CSV_CACHE, 'utf8'));
  }
  const res = await fetch(`${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=yugioh-cards`);
  if (!res.ok) throw new Error(`CSV download ${res.status}`);
  const text = await res.text();
  if (CSV_CACHE) fs.writeFileSync(CSV_CACHE, text);
  const products = parseCsv(text);
  // An invalid category silently returns the 121k all-products video-game catalog
  // (first console "3DO"). Abort rather than ingest garbage.
  if (products[0]?.['console-name'] === '3DO') throw new Error('got the all-products fallback, not yugioh-cards');
  return products;
}

// Region prefixes seen in the codes, by frequency across the 77k-row CSV:
//   EN 47,625 · JP 14,713 · (none) 5,572 · E 1,232 · ENA 521 · ENB 455 · ENC 394 · ...
// Three of them line up with our catalog, and our own card IDS say which is which:
//   ygo-lob-027    -> bare  "LOB-027"    North American
//   ygo-lob-en027  -> EN    "LOB-EN027"  English
//   ygo-lob-e021   -> E     "LOB-E021"   European
// 20 vintage Yu-Gi-Oh sets carry two or three of these schemes side by side (lob,
// lon, mrd, mrl, dcr, lod, ...). They are NOT duplicate rows: they are separate
// printings that trade at different prices — Aqua Madoor is $0.96 as LOB-027 and
// $2.35 as LOB-E021 — so each row is matched to its OWN region.
// "JP" is a different catalog and ENA/ENB/... are sub-series whose letters our
// `number` column does not carry; both are skipped rather than guessed across.
const ACCEPTED_PREFIXES = new Set(['', 'EN', 'E']);

/** "Aqua Madoor [1st Edition] LOB-027" -> { num:'27', prefix:'', isVariant:true }. */
function parseProduct(name) {
  const m = String(name).match(/\b([A-Z0-9]{2,6})-([A-Za-z]*)(\d{1,4})\s*$/);
  if (!m) return null;
  const prefix = (m[2] || '').toUpperCase();
  if (!ACCEPTED_PREFIXES.has(prefix)) return null;
  return { num: stripNum(m[3]), prefix, isVariant: /\[|\(/.test(name) };
}

/** Region implied by our own card id: ygo-lob-en027 -> 'EN', -e021 -> 'E', -027 -> ''. */
function regionOfCardId(id, setId) {
  const tail = String(id).startsWith(`${setId}-`) ? String(id).slice(setId.length + 1) : String(id);
  if (/^en\d/i.test(tail)) return 'EN';
  if (/^e\d/i.test(tail)) return 'E';
  if (/^\d/.test(tail)) return '';
  return null; // unknown shape — fall back to the set-wide preference
}

(async () => {
  console.log(COMMIT ? '== COMMIT run ==' : '== DRY RUN (pass --commit to write) ==');
  const products = await loadProducts();
  console.log(`CSV rows: ${products.length}`);

  const byConsole = new Map();
  for (const p of products) {
    const c = p['console-name']; if (!c) continue;
    if (!byConsole.has(c)) byConsole.set(c, []);
    byConsole.get(c).push(p);
  }
  const consoleByNorm = new Map();
  for (const c of byConsole.keys()) {
    consoleByNorm.set(norm(c), c);
    consoleByNorm.set(norm(c.replace(/^yugioh\s*/i, '')), c); // consoles are prefixed "YuGiOh <set>"
  }

  const { data: allSets, error: setErr } = await supabase
    .from('pokemon_sets').select('id, name').eq('game', 'yugioh').eq('language', 'en');
  if (setErr) throw new Error(`sets: ${setErr.message}`);

  let targets = allSets ?? [];
  if (setsArg) {
    const want = new Set(setsArg.split(',').map((s) => s.trim()));
    targets = targets.filter((s) => want.has(s.id));
  } else if (!ALL_SETS) {
    // Default to the sets that have NO raw price at all — the gap this exists for.
    // Paged: PostgREST caps every response at 1000 rows regardless of .limit().
    const priced = new Set();
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('market_values').select('card_id, pokemon_cards!inner(set_id)')
        .eq('game', 'yugioh').eq('language', 'en').eq('condition', 'Raw_NM')
        .order('card_id', { ascending: true }).range(p * 1000, p * 1000 + 999);
      if (error) throw new Error(`coverage: ${error.message}`);
      for (const r of data ?? []) if (r.pokemon_cards?.set_id) priced.add(r.pokemon_cards.set_id);
      if (!data || data.length < 1000) break;
    }
    targets = targets.filter((s) => !priced.has(s.id));
    console.log(`targeting ${targets.length} sets with no Raw_NM row (${priced.size} already priced)`);
  }

  const allRows = [];
  const now = new Date().toISOString();
  let noConsole = 0, skippedSets = [], totalMatched = 0, totalCards = 0, protectedRows = 0;

  for (const set of targets) {
    const consoleName = consoleByNorm.get(norm(set.name)) ?? consoleByNorm.get(norm(`yugioh ${set.name}`));
    if (!consoleName) { noConsole++; continue; }
    const pcRows = byConsole.get(consoleName);

    const { data: ours, error } = await supabase
      .from('pokemon_cards').select('id, number, name').eq('set_id', set.id).eq('language', 'en');
    if (error) throw new Error(`cards ${set.id}: ${error.message}`);
    if (!ours?.length) continue;

    // Deliberate pins must never be overwritten.
    const pinned = new Set();
    for (let i = 0; i < ours.length; i += 200) {
      const { data: existing } = await supabase
        .from('market_values').select('card_id, source')
        .eq('language', 'en').eq('condition', 'Raw_NM')
        .in('card_id', ours.slice(i, i + 200).map((c) => c.id));
      for (const m of existing ?? []) if (['admin', 'cardstreet'].includes(m.source)) pinned.add(m.card_id);
    }

    // Index by REGION+number, not number alone. Matching on number alone made the
    // European rows collide with North American ones — our ygo-lob-e021 (Aqua
    // Madoor) was being paired against PriceCharting's LOB-021, a different card,
    // which is what dragged the set's name agreement down to 72% and got it skipped.
    const setPrefix = ours.some((c) => /-en\d/i.test(c.id)) ? 'EN' : '';
    const pcByKey = new Map();
    for (const p of pcRows) {
      const parsed = parseProduct(p['product-name']);
      if (!parsed) continue;
      const key = `${parsed.prefix}|${parsed.num}`;
      const prev = pcByKey.get(key);
      if (!prev || (prev.isVariant && !parsed.isVariant)) pcByKey.set(key, { p, ...parsed });
    }
    const lookup = (c) => {
      const region = regionOfCardId(c.id, set.id) ?? setPrefix;
      return pcByKey.get(`${region}|${stripNum(c.number)}`)
        // A set with only one scheme upstream still resolves when our id shape says
        // otherwise (most modern sets are EN-only).
        ?? pcByKey.get(`${setPrefix}|${stripNum(c.number)}`);
    };

    const candidates = [];
    let nameAgree = 0, matched = 0;
    for (const c of ours) {
      const hit = lookup(c);
      if (!hit) continue;
      matched++;
      const pcName = norm(String(hit.p['product-name']).replace(/\b[A-Z0-9]{2,6}-[A-Za-z]*\d{1,4}\s*$/, '').replace(/\[[^\]]*\]/g, ''));
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
        // The column defaults to THB — without this every USD price renders ~36x low.
        currency: 'USD',
        game: 'yugioh',
        printing: null,
        source_links: [`${BASE}/game/${encodeURIComponent(consoleName.toLowerCase().replace(/\s+/g, '-'))}/${String(hit.p.id)}`],
        source_prices: { market_price: price, source: 'pricecharting', pricecharting_id: String(hit.p.id), console: consoleName, method: 'pc_loose' },
        last_updated: now,
        last_priced_at: now,
      });
    }

    const agree = matched ? nameAgree / matched : 0;
    totalMatched += matched; totalCards += ours.length;

    let rows = candidates, method = 'number';
    if (matched && agree < NAME_AGREEMENT_MIN) {
      // The set's numbering does not line up with PriceCharting's — for ygo-lob our
      // #003 is "Dark Magician" where theirs is "Flame Swordsman". Pairing by number
      // here would be random, so fall back to matching on NAME, and only where the
      // name identifies exactly one card on BOTH sides. Ambiguous names are dropped
      // rather than guessed, which is why this cannot reintroduce the mis-pairing.
      const pcByName = new Map();
      for (const p of pcRows) {
        const parsed = parseProduct(p['product-name']);
        if (!parsed) continue;
        const key = norm(String(p['product-name']).replace(/\b[A-Z0-9]{2,6}-[A-Za-z]*\d{1,4}\s*$/, '').replace(/\[[^\]]*\]/g, ''));
        if (!key) continue;
        const prev = pcByName.get(key);
        // Ambiguity is recorded, not resolved: a name held by two different prints
        // is dropped unless one is the plain base print.
        if (!prev) pcByName.set(key, { p, isVariant: parsed.isVariant, dupe: false });
        else if (prev.isVariant && !parsed.isVariant) pcByName.set(key, { p, isVariant: parsed.isVariant, dupe: false });
        else if (!prev.isVariant && !parsed.isVariant) prev.dupe = true;
      }
      const ourNameCounts = new Map();
      for (const c of ours) ourNameCounts.set(norm(c.name), (ourNameCounts.get(norm(c.name)) ?? 0) + 1);

      rows = []; method = 'name';
      for (const c of ours) {
        const key = norm(c.name);
        if (ourNameCounts.get(key) !== 1) continue;
        const hit = pcByName.get(key);
        if (!hit || hit.dupe) continue;
        const price = usd(hit.p['loose-price']);
        if (!price) continue;
        if (pinned.has(c.id)) { protectedRows++; continue; }
        rows.push({
          card_id: c.id, language: 'en', condition: 'Raw_NM', market_avg: price,
          currency: 'USD', game: 'yugioh', printing: null,
          source_links: [`${BASE}/game/${encodeURIComponent(consoleName.toLowerCase().replace(/\s+/g, '-'))}/${String(hit.p.id)}`],
          source_prices: { market_price: price, source: 'pricecharting', pricecharting_id: String(hit.p.id), console: consoleName, method: 'pc_loose_byname' },
          last_updated: now, last_priced_at: now,
        });
      }
      if (!rows.length) {
        console.warn(`  ${set.id.padEnd(14)} SKIPPED — number agreement ${Math.round(agree * 100)}% and no unambiguous name matches`);
        skippedSets.push(set.id);
        continue;
      }
      console.log(`  ${set.id.padEnd(14)} ${consoleName.slice(0, 44).padEnd(45)} number agreement ${Math.round(agree * 100)}% -> matched BY NAME: ${rows.length}/${ours.length}`);
      allRows.push(...rows);
      continue;
    }
    if (!rows.length) continue;
    console.log(`  ${set.id.padEnd(14)} ${consoleName.slice(0, 44).padEnd(45)} matched ${String(matched).padStart(4)}/${String(ours.length).padEnd(4)} names ${String(Math.round(agree * 100)).padStart(3)}%  -> ${rows.length} priced (${method})`);
    allRows.push(...rows);
  }

  console.log(`\nprepared ${allRows.length} Raw_NM rows (matched ${totalMatched}/${totalCards} cards in mapped sets)`);
  if (noConsole) console.log(`${noConsole} sets have no PriceCharting console — neither vendor carries them`);
  if (protectedRows) console.log(`skipped ${protectedRows} rows pinned to admin/cardstreet`);
  if (skippedSets.length) console.log(`skipped on name disagreement: ${skippedSets.join(', ')}`);
  if (allRows.length) {
    const prices = allRows.map((r) => r.market_avg).sort((a, b) => a - b);
    console.log(`price range: $${prices[0]} .. $${prices[prices.length - 1]}, median $${prices[Math.floor(prices.length / 2)]}`);
  }
  if (!COMMIT) { console.log('\nDRY RUN — nothing written.'); return; }

  for (let i = 0; i < allRows.length; i += 500) {
    const { error } = await supabase.from('market_values')
      .upsert(allRows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
    if (error) throw new Error(`upsert: ${error.message}`);
  }
  console.log(`wrote ${allRows.length} market_values rows`);
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
