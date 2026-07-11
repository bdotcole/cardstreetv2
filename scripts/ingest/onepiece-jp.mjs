// PriceCharting -> Japanese One Piece catalog + prices.
//
// JustTCG has NO Japanese One Piece game (it mirrors TCGplayer, which carries no
// JP One Piece catalog; the *-japan slug 400s), so PriceCharting is both the
// catalog list AND the price source for JP. JP products live INSIDE the
// one-piece-cards CSV under "One Piece Japanese <set>" console names — the
// "one-piece-japanese-cards" slug is NOT a real category (it silently returns the
// all-products fallback, same trap as pokemon-japanese-cards).
//
//   node scripts/ingest/onepiece-jp.mjs                        # DRY: mapping + counts
//   node scripts/ingest/onepiece-jp.mjs --commit               # write everything
//   node scripts/ingest/onepiece-jp.mjs --commit --no-images   # skip PC page image scrape
//   node scripts/ingest/onepiece-jp.mjs --commit --set=op-01   # one set (derived code)
//
// One card row per printed code per set — alt arts / parallels collapse onto the
// base print, mirroring the EN optcgapi catalog and the JustTCG name-collapse.
// The full variant list is preserved in raw_data.pc_variants. Writes:
//   pokemon_sets    op-<code>-jp, language 'ja'
//   pokemon_cards   op-<code>-jp-<cardcode>, language 'ja', rarity enriched from EN twin
//   market_values   loose -> 'Raw_NM' + graded fields -> 'PSA 10' etc., language 'jp'
//   pricecharting_map  card -> base product id (weekly cron then keeps prices fresh)
// Images are scraped from PriceCharting product pages (tier-2 pattern from
// pricecharting-images.mjs); the monthly mirror cron re-homes them to our storage.
// Idempotent; the image scrape skips cards that already have an image.

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

const TOKEN = env.PRICECHARTING_TOKEN;
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'https://www.pricecharting.com';

const JP_CONSOLE_RE = /^one piece japanese\b/i;

// Keep in sync with lib/pricecharting.ts / pricecharting.mjs (mjs can't import TS).
const GRADED_FIELD_MAP = {
  'graded-price': 'PSA 9',
  'box-only-price': 'BGS 9.5',
  'manual-only-price': 'PSA 10',
  'bgs-10-price': 'BGS 10',
  'condition-17-price': 'CGC 10',
  'condition-18-price': 'SGC 10',
};
const CARD_NUMBER_RE = /#\s*[A-Za-z]{0,5}\d{1,4}\b/;
const CARD_SETCODE_RE = /\b[A-Z]{1,5}\d{0,2}-[A-Z]{0,4}\d{1,4}[a-z]?\b\s*$/;
const CONTAINER_HEAD_RE = /^\s*(sealed\s+|factory\s+sealed\s+)?(booster box|booster pack|booster bundle|elite trainer box|\betb\b|double pack|triple pack|build\s*&?\s*battle|starter deck|structure deck|prerelease|bundle box|display box|booster case)\b/i;
const CARD_VARIANT_RE = /\[(foil|non-?foil[^\]]*|etched[^\]]*|extended art|borderless|showcase|retro frame|full art|alt(?:ernate)? art|[^\]]*\bfoil\b|serial(?:ized)?|prize pack[^\]]*|tin topper|box topper|storage box set[^\]]*|illustration box[^\]]*|dash pack|welcome pack[^\]]*|master ball|poke ball|reverse holo)\]/i;

function looksLikeCardProductName(name) {
  const n = name || '';
  if (CARD_VARIANT_RE.test(n)) return true;
  return (CARD_NUMBER_RE.test(n) || CARD_SETCODE_RE.test(n)) && !CONTAINER_HEAD_RE.test(n);
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// CSV prices are dollar strings ("$1,234.50"), not the JSON API's integer cents.
const usd = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Consoles whose products carry ORIGINAL set codes (reprint compilations, promos),
// so the majority-code-prefix derivation below can't name them. Keyed by
// norm(console name minus "One Piece Japanese").
const CONSOLE_SET_OVERRIDES = {
  'promo': 'promo',
  'carddass hyper battle promo': 'carddass-promo',
  'premium booster': 'prb-01',
  'premium booster 2': 'prb-02',
  // PC files several P-/ST11-coded products under the ST16 console, breaking the
  // majority-prefix test; the console is genuinely Starter Deck 16.
  'starter deck 16 uta': 'st-16',
};

// "OP01" -> "op-01", "ST18" -> "st-18", "EB01" -> "eb-01".
function formatSetCode(prefix) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(prefix || '');
  return m ? `${m[1].toLowerCase()}-${m[2]}` : null;
}

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

async function downloadCsv(category) {
  const url = `${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=${encodeURIComponent(category)}`;
  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch(url);
    if (res.status !== 429) break;
    await sleep(8000);
  }
  if (!res.ok) throw new Error(`CSV download ${res.status} for category "${category}"`);
  const rows = parseCsv(await res.text());
  const header = rows[0].map((h) => h.trim());
  const products = rows.slice(1).filter((r) => r.length >= header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  if (products[0]?.['console-name'] === '3DO') {
    throw new Error(`category "${category}" returned the all-products fallback — wrong slug.`);
  }
  return products;
}

// Scrape a PriceCharting product page for its cover-image hash (tier-2 pattern
// from pricecharting-images.mjs). Card-page hashes are base36 alphanumeric
// ("qxbh4umdzamyxelr"), unlike the hex hashes on sealed pages — don't narrow
// this regex to [a-f0-9]. Valid size variants: 1600 (full), 240, 120.
async function scrapePcImage(pcId) {
  try {
    const res = await fetch(`${BASE}/offers?product=${encodeURIComponent(pcId)}`);
    if (!res.ok) return null;
    const html = await res.text();
    const m = /images\.pricecharting\.com\/([a-z0-9]{12,})\//i.exec(html);
    return m ? `https://storage.googleapis.com/images.pricecharting.com/${m[1]}/1600.jpg` : null;
  } catch { return null; }
}

async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw error;
  }
}

// EN twin lookup (rarity + gameplay raw_data enrichment for shared codes): the JP
// booster/EB/PRB sets share printed codes with the EN catalog rows we already have.
async function loadEnTwins() {
  const byCode = new Map(); // `${setCode}|${cardcode}` e.g. "op-01|op01-016" -> {rarity, raw}
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('id, set_id, rarity, raw_data')
      .eq('game', 'onepiece')
      .eq('language', 'en')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const c of data) {
      const code = (c.raw_data?.card_set_id || '').toLowerCase();
      if (!code) continue;
      const setCode = c.set_id.replace(/^op-/, ''); // "op-op-01" -> "op-01"
      byCode.set(`${setCode}|${code}`, { rarity: c.rarity, raw: c.raw_data });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return byCode;
}

async function main() {
  if (!TOKEN) throw new Error('PRICECHARTING_TOKEN missing from .env.local');
  const commit = process.argv.includes('--commit');
  const noImages = process.argv.includes('--no-images');
  const setFilter = process.argv.find((a) => a.startsWith('--set='))?.split('=')[1] || null;

  const [products, enTwins] = await Promise.all([downloadCsv('one-piece-cards'), loadEnTwins()]);
  const jpProducts = products.filter((p) => JP_CONSOLE_RE.test(p['console-name'] || ''));
  console.log(`[opjp] CSV products: ${products.length} total, ${jpProducts.length} Japanese; EN twins indexed: ${enTwins.size}${commit ? '' : '  [DRY]'}`);

  // ── Pass 1: group singles by console, derive each console's set code ─────────
  const consoles = new Map(); // console-name -> { products: [], prefixCounts: Map }
  let sealedSkipped = 0, noCodeSkipped = 0;
  for (const p of jpProducts) {
    const pname = p['product-name'] || '';
    if (!looksLikeCardProductName(pname)) { sealedSkipped++; continue; }
    const codeMatch = /\s([A-Za-z0-9]+-[A-Za-z0-9]+)\s*$/.exec(pname);
    if (!codeMatch) { noCodeSkipped++; continue; } // DON!! cards etc. carry no code
    const code = codeMatch[1].toUpperCase();
    const c = p['console-name'];
    if (!consoles.has(c)) consoles.set(c, { products: [], prefixCounts: new Map() });
    const entry = consoles.get(c);
    entry.products.push({ ...p, __code: code, __namePart: pname.slice(0, codeMatch.index) });
    const prefix = code.split('-')[0];
    entry.prefixCounts.set(prefix, (entry.prefixCounts.get(prefix) || 0) + 1);
  }

  const setRows = [];
  const cardsBySet = new Map(); // setRowId -> Map(code -> variants[])
  const setMeta = new Map();    // setRowId -> { name, setCode }
  const unresolvedConsoles = [];
  for (const [consoleName, entry] of consoles) {
    const strippedName = consoleName.replace(JP_CONSOLE_RE, '').trim();
    let setCode = CONSOLE_SET_OVERRIDES[norm(strippedName)] || null;
    if (!setCode) {
      // Majority code-prefix (>=70%) names the set: OP01 -> op-01, ST05 -> st-05.
      const [topPrefix, topCount] = [...entry.prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topCount / entry.products.length >= 0.7) setCode = formatSetCode(topPrefix);
    }
    if (!setCode) { unresolvedConsoles.push(`${consoleName} (${entry.products.length} products, prefixes: ${[...entry.prefixCounts.keys()].join(',')})`); continue; }
    if (setFilter && setCode !== setFilter) continue;

    const setRowId = `op-${setCode}-jp`;
    setMeta.set(setRowId, { name: strippedName, setCode });
    if (!cardsBySet.has(setRowId)) cardsBySet.set(setRowId, new Map());
    const byCode = cardsBySet.get(setRowId);
    for (const p of entry.products) {
      if (!byCode.has(p.__code)) byCode.set(p.__code, []);
      byCode.get(p.__code).push(p);
    }
  }

  // ── Pass 2: pick the base print per code, build rows ─────────────────────────
  const cardRows = [];
  const mvRows = [];
  const mapRows = [];
  let rarityEnriched = 0, ungradedPriced = 0, gradedRows = 0;
  const now = new Date().toISOString();
  for (const [setRowId, byCode] of cardsBySet) {
    const meta = setMeta.get(setRowId);
    setRows.push({
      id: setRowId,
      name: meta.name,
      series: 'One Piece Card Game',
      printed_total: byCode.size,
      total: byCode.size,
      language: 'ja',
      game: 'onepiece',
    });
    for (const [code, variants] of byCode) {
      // Base print = product-name without bracket/paren qualifiers; when only
      // variants exist (promo alt arts), the cheapest loose print stands in.
      const base = variants.find((v) => !/[\[(]/.test(v['product-name']));
      const chosen = base
        || [...variants].sort((a, b) => (usd(a['loose-price']) ?? Infinity) - (usd(b['loose-price']) ?? Infinity))[0];
      const name = chosen.__namePart.replace(/\[[^\]]*\]/g, '').trim() || code;
      const cardId = `${setRowId}-${code.toLowerCase()}`;
      const twin = enTwins.get(`${meta.setCode}|${code.toLowerCase()}`);
      if (twin?.rarity) rarityEnriched++;
      cardRows.push({
        id: cardId,
        name,
        english_name: name, // PC product names are English; keeps EN search working
        set_id: setRowId,
        number: (code.split('-').pop() || '').replace(/[^0-9]/g, '') || null,
        rarity: twin?.rarity || null,
        image_small: '', // scraped below / mirrored by the monthly cron
        image_large: '',
        language: 'ja',
        game: 'onepiece',
        raw_data: {
          card_set_id: code,
          color: twin?.raw?.color ?? null,
          type: twin?.raw?.type ?? null,
          cost: twin?.raw?.cost ?? null,
          power: twin?.raw?.power ?? null,
          pc_console: chosen['console-name'],
          pc_variants: variants.map((v) => ({ pc_id: String(v.id), name: v['product-name'], loose: usd(v['loose-price']) })),
        },
      });
      const loose = usd(chosen['loose-price']);
      if (loose != null) {
        ungradedPriced++;
        mvRows.push({ card_id: cardId, language: 'jp', condition: 'Raw_NM', printing: null, market_avg: loose, currency: 'USD', game: 'onepiece', last_updated: now });
      }
      for (const [field, condition] of Object.entries(GRADED_FIELD_MAP)) {
        const price = usd(chosen[field]);
        if (price == null) continue;
        gradedRows++;
        mvRows.push({ card_id: cardId, language: 'jp', condition, printing: null, market_avg: price, currency: 'USD', game: 'onepiece', last_updated: now });
      }
      mapRows.push({ card_id: cardId, pricecharting_id: String(chosen.id), game: 'onepiece', console_name: chosen['console-name'], matched_at: now, last_priced_at: now });
    }
  }

  console.log(`[opjp] singles skipped: ${sealedSkipped} sealed/other, ${noCodeSkipped} code-less (DON etc.)`);
  console.log(`[opjp] sets: ${setRows.length}, cards: ${cardRows.length}, ungraded priced: ${ungradedPriced}, graded price rows: ${gradedRows}, rarity from EN twin: ${rarityEnriched}`);
  for (const s of setRows.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${s.id}  ${String(s.total).padStart(4)} cards  ${s.name}`);
  }
  if (unresolvedConsoles.length) {
    console.log(`[opjp] UNRESOLVED consoles (add to CONSOLE_SET_OVERRIDES):\n  ${unresolvedConsoles.join('\n  ')}`);
  }
  if (!commit) { console.log('[opjp] DRY RUN: nothing written (--commit to write)'); return; }

  // ── Images: scrape PC product pages for cards that don't have one yet ────────
  if (!noImages) {
    const existing = new Map();
    const ids = cardRows.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from('pokemon_cards').select('id, image_small').in('id', ids.slice(i, i + 200));
      if (error) throw error;
      for (const r of data || []) if (r.image_small) existing.set(r.id, r.image_small);
    }
    const need = cardRows.filter((c) => !existing.get(c.id));
    console.log(`[opjp] image scrape: ${need.length} cards need images (${existing.size} already have one)`);
    let scraped = 0, missing = 0;
    const mapByCard = new Map(mapRows.map((m) => [m.card_id, m.pricecharting_id]));
    await pool(need, 8, async (c, i) => {
      const url = await scrapePcImage(mapByCard.get(c.id));
      if (url) { c.image_small = url; c.image_large = url; scraped++; } else missing++;
      if ((i + 1) % 250 === 0) console.log(`[opjp]   ...${i + 1}/${need.length} pages (${scraped} images)`);
    });
    // Keep an already-stored image when this run found none (idempotent re-runs).
    for (const c of cardRows) {
      if (!c.image_small && existing.get(c.id)) { c.image_small = existing.get(c.id); c.image_large = existing.get(c.id); }
    }
    console.log(`[opjp] images: ${scraped} scraped, ${missing} pages without an image`);
  }

  await upsert('pokemon_sets', setRows, 'id');
  await upsert('pokemon_cards', cardRows, 'id');
  await upsert('market_values', mvRows, 'card_id,language,condition');
  await upsert('pricecharting_map', mapRows, 'card_id');
  console.log(`[opjp] wrote ${setRows.length} sets, ${cardRows.length} cards, ${mvRows.length} market_values, ${mapRows.length} map rows`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[opjp] FAILED:', e.message); process.exit(1); });
