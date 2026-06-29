// PriceCharting -> graded market_values + sealed_products ingestion.
//
// PriceCharting (Legendary plan) supplies GRADED card prices and SEALED product
// prices. This pulls the bulk price-guide CSV per category (the scalable path —
// one download covers a whole game), matches card rows to our catalog, and writes:
//   graded -> market_values (condition "PSA 10" etc., USD) + pricecharting_map
//   sealed -> sealed_products
//
//   node scripts/ingest/pricecharting.mjs graded pokemon            # all EN Pokemon sets
//   node scripts/ingest/pricecharting.mjs graded pokemon --set=sv3  # one set
//   node scripts/ingest/pricecharting.mjs graded pokemon-jp         # Japanese Pokemon (lang=ja)
//   node scripts/ingest/pricecharting.mjs sealed pokemon
//   node scripts/ingest/pricecharting.mjs graded mtg --dry          # preview match rate, write nothing
//
// RUN scripts/test-pricecharting.mjs FIRST to confirm the field mapping + CSV
// endpoint, and run with --dry on one set before the full write (per CLAUDE.md).
//
// Prices are USD (currency='USD'); cardMapper / the graded route convert to THB.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// .env.local loader — CRLF-safe + quote-stripping (same as justtcg-prices.mjs).
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

// Keep in sync with lib/pricecharting.ts (mjs can't import the TS module).
const GRADED_FIELD_MAP = {
  'graded-price': 'PSA 9',
  'box-only-price': 'BGS 9.5',
  'manual-only-price': 'PSA 10',
  'bgs-10-price': 'BGS 10',
  'condition-17-price': 'CGC 10',
  'condition-18-price': 'SGC 10',
};

// Our ingest game -> { catalog game, catalog language filter, market language, PC category }.
const GAME_CONFIG = {
  pokemon:      { game: 'pokemon',  lang: 'en', marketLang: 'en', category: 'pokemon-cards' },
  'pokemon-jp': { game: 'pokemon',  lang: 'ja', marketLang: 'jp', category: 'pokemon-japanese-cards' },
  mtg:          { game: 'mtg',      lang: null, marketLang: 'en', category: 'magic-cards' },
  yugioh:       { game: 'yugioh',   lang: null, marketLang: 'en', category: 'yugioh-cards' },
  onepiece:     { game: 'onepiece', lang: null, marketLang: 'en', category: 'one-piece-cards' },
  lorcana:      { game: 'lorcana',  lang: null, marketLang: 'en', category: 'lorcana-cards' },
};

// PriceCharting console-name -> our set_id, for sets whose names don't normalize-match.
// Fill from the "unresolved console-name" warnings the script prints.
const SET_NAME_OVERRIDES = {
  // 'scarlet violet 151': 'sv2a',
};

const SEALED_KEYWORDS = [
  [/elite trainer box|\betb\b/i, 'etb'],
  [/booster box/i, 'booster_box'],
  [/booster bundle|booster pack|\bpack\b/i, 'booster_pack'],
  [/bundle/i, 'bundle'],
  [/collection|tin|premium|box set|gift/i, 'collection'],
];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normNum = (s) => String(s || '').toLowerCase().replace(/(\D)0+(?=\d)/, '$1').replace(/^0+(?=\d)/, '');
// The bulk CSV formats prices as dollar strings ("$1,234.50") — NOT the integer
// cents the JSON product API returns. This script reads the CSV, so parse dollars.
const usd = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

function classifySealed(productName) {
  const name = productName || '';
  const looksLikeCard = /#\s*\w+/.test(name);
  for (const [re, type] of SEALED_KEYWORDS) if (re.test(name)) return type;
  if (!looksLikeCard && /\b(box|case|display|collection)\b/i.test(name)) return 'other';
  return null;
}

function stripGamePrefix(consoleName) {
  return (consoleName || '')
    .replace(/^pokemon japanese/i, '')
    .replace(/^pokemon/i, '')
    .replace(/^magic[:\- ]*the gathering/i, '')
    .replace(/^magic/i, '')
    .replace(/^yu-?gi-?oh!?/i, '')
    .replace(/^one piece( card game)?/i, '')
    .replace(/^(disney )?lorcana/i, '')
    .trim();
}

// ── Minimal CSV parser (handles quoted fields + embedded commas/quotes) ──────────
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadCsv(category) {
  const url = `${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=${encodeURIComponent(category)}`;
  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch(url);
    if (res.status !== 429) break;
    await sleep(8000); // rate limited — back off and retry
  }
  if (!res.ok) throw new Error(`CSV download ${res.status} for category "${category}". Confirm endpoint/category via test-pricecharting.mjs.`);
  const rows = parseCsv(await res.text());
  if (!rows.length) throw new Error('CSV empty');
  const header = rows[0].map((h) => h.trim());
  const products = rows.slice(1).filter((r) => r.length >= header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  // An invalid category slug silently returns the ENTIRE PriceCharting catalog
  // (all video-game consoles, alphabetically -> first console "3DO"). Abort rather
  // than match/pollute against the wrong dataset.
  if (products[0]?.['console-name'] === '3DO') {
    throw new Error(`category "${category}" returned the all-products fallback (${products.length} rows) — wrong slug.`);
  }
  return products;
}

async function loadCatalog(cfg, setFilter) {
  const byNumber = new Map(); // `${set_id}|${normNum}` -> card id
  const byName = new Map();   // `${set_id}|${normName}` -> card id
  const setByName = new Map();// normalized set name -> set_id
  const setIds = setFilter ? setFilter.split(',').flatMap((s) => [s.trim(), `${cfg.game}-${s.trim()}`]) : null;
  let from = 0;
  for (;;) {
    let q = supabase.from('pokemon_cards')
      .select('id, name, english_name, number, set_id, language, pokemon_sets(name)')
      .eq('game', cfg.game);
    if (cfg.lang) q = q.eq('language', cfg.lang);
    if (setIds) q = q.in('set_id', setIds);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const c of data) {
      if (c.number) { const k = `${c.set_id}|${normNum(c.number)}`; if (!byNumber.has(k)) byNumber.set(k, c.id); }
      for (const nm of [c.name, c.english_name]) {
        if (nm) { const k = `${c.set_id}|${norm(nm)}`; if (!byName.has(k)) byName.set(k, c.id); }
      }
      const setName = c.pokemon_sets?.name;
      if (setName) setByName.set(norm(setName), c.set_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return { byNumber, byName, setByName };
}

function resolveSetId(consoleName, setByName) {
  const key = norm(stripGamePrefix(consoleName));
  return SET_NAME_OVERRIDES[key] || setByName.get(key) || null;
}

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw error;
  }
}

async function runGraded(cfg, products, idx, dry, limit) {
  // Multiple PriceCharting products (reverse holo, jumbo, staff, etc.) can map to
  // one of our cards. Dedupe so a single upsert batch never holds two rows for the
  // same (card_id, language, condition) — Postgres rejects that ("cannot affect row
  // a second time"). Prefer the base print (product-name with no [..]/(..) qualifier).
  const mvByKey = new Map();   // `${cardId}|${lang}|${condition}` -> { isBase, row }
  const mapByCard = new Map(); // cardId -> { isBase, row }
  let cards = 0, matched = 0;
  const unresolvedSets = new Set();
  for (const p of products) {
    const pname = p['product-name'] || '';
    if (classifySealed(pname)) continue; // sealed handled separately
    // Extract collector number + clean name. Pokemon/Magic/Lorcana print "#123";
    // One Piece / Yu-Gi-Oh print a trailing set code ("OP07-002", "LOB-EN001").
    let rawNum = null, namePart = pname;
    const hash = /#\s*([A-Za-z0-9]+)/.exec(pname);
    if (hash) { rawNum = hash[1]; namePart = pname.slice(0, hash.index); }
    else {
      const code = /\s([A-Za-z0-9]+-[A-Za-z0-9]+)\s*$/.exec(pname);
      if (code) { rawNum = code[1]; namePart = pname.slice(0, code.index); }
    }
    const setId = resolveSetId(p['console-name'], idx.setByName);
    if (!setId) { unresolvedSets.add(p['console-name']); continue; }
    cards++;
    const name = norm(namePart);
    let cardId = rawNum ? idx.byNumber.get(`${setId}|${normNum(rawNum)}`) : undefined;
    if (!cardId && name) cardId = idx.byName.get(`${setId}|${name}`);
    if (!cardId) continue;
    matched++;
    const isBase = !/[\[(]/.test(pname);
    const now = new Date().toISOString();
    for (const [field, condition] of Object.entries(GRADED_FIELD_MAP)) {
      const price = usd(p[field]);
      if (price == null) continue;
      const key = `${cardId}|${cfg.marketLang}|${condition}`;
      const prev = mvByKey.get(key);
      if (!prev || (isBase && !prev.isBase)) {
        mvByKey.set(key, { isBase, row: { card_id: cardId, language: cfg.marketLang, condition, printing: null, market_avg: price, currency: 'USD', game: cfg.game, last_updated: now } });
      }
    }
    const prevMap = mapByCard.get(cardId);
    if (!prevMap || (isBase && !prevMap.isBase)) {
      mapByCard.set(cardId, { isBase, row: { card_id: cardId, pricecharting_id: String(p.id), game: cfg.game, console_name: p['console-name'], matched_at: now, last_priced_at: now } });
    }
    if (limit && matched >= limit) break;
  }
  const mvRows = [...mvByKey.values()].map((v) => v.row);
  const mapRows = [...mapByCard.values()].map((v) => v.row);
  console.log(`[pc:graded] CSV cards: ${cards}, matched rows: ${matched}, distinct cards: ${mapRows.length}, graded rows: ${mvRows.length}`);
  if (unresolvedSets.size) console.log(`[pc:graded] unresolved console-names (add to SET_NAME_OVERRIDES): ${[...unresolvedSets].slice(0, 25).join(' | ')}`);
  if (dry) { console.log('[pc:graded] --dry: nothing written'); return; }
  await upsert('market_values', mvRows, 'card_id,language,condition');
  await upsert('pricecharting_map', mapRows, 'card_id');
  console.log(`[pc:graded] wrote ${mvRows.length} market_values + ${mapRows.length} map rows`);
}

async function runSealed(cfg, products, idx, dry, limit) {
  const rows = [];
  let found = 0, resolved = 0;
  const unresolved = new Set();
  for (const p of products) {
    const type = classifySealed(p['product-name']);
    if (!type) continue;
    found++;
    const setId = resolveSetId(p['console-name'], idx.setByName);
    if (setId) resolved++; else unresolved.add(p['console-name']);
    rows.push({
      id: `pc-${p.id}`,
      game: cfg.game,
      language: cfg.marketLang,
      set_id: setId,
      name: p['product-name'],
      product_type: type,
      image_url: null, // CSV carries no image; JSON product endpoint can backfill later
      pricecharting_id: String(p.id),
      console_name: p['console-name'],
      loose_price: usd(p['loose-price']),
      cib_price: usd(p['cib-price']),
      new_price: usd(p['new-price']),
      currency: 'USD',
      last_updated: new Date().toISOString(),
    });
    if (limit && found >= limit) break;
  }
  console.log(`[pc:sealed] sealed products: ${found}, with set_id: ${resolved}`);
  if (unresolved.size) console.log(`[pc:sealed] unresolved console-names (${unresolved.size}): ${[...unresolved].slice(0, 20).join(' | ')}`);
  if (dry) { console.log('[pc:sealed] --dry: nothing written'); return; }
  await upsert('sealed_products', rows, 'id');
  console.log(`[pc:sealed] upserted ${rows.length} sealed_products`);
}

async function main() {
  if (!TOKEN) throw new Error('PRICECHARTING_TOKEN missing from .env.local');
  const mode = (process.argv[2] || '').toLowerCase();        // graded | sealed
  const game = (process.argv[3] || 'pokemon').toLowerCase();
  const dry = process.argv.includes('--dry');
  const setFilter = process.argv.find((a) => a.startsWith('--set='))?.split('=')[1];
  const limit = parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || 0;
  const cfg = GAME_CONFIG[game];
  if (!['graded', 'sealed'].includes(mode)) throw new Error('mode must be "graded" or "sealed"');
  if (!cfg) throw new Error(`unknown game "${game}" (one of: ${Object.keys(GAME_CONFIG).join(', ')})`);

  console.log(`[pc] ${mode} ${game} (category=${cfg.category})${dry ? ' [DRY]' : ''}${setFilter ? ` set=${setFilter}` : ''}`);
  const [products, idx] = await Promise.all([downloadCsv(cfg.category), loadCatalog(cfg, setFilter)]);
  console.log(`[pc] CSV products: ${products.length}, catalog sets: ${idx.setByName.size}`);

  if (mode === 'graded') await runGraded(cfg, products, idx, dry, limit);
  else await runSealed(cfg, products, idx, dry, limit);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[pc] FAILED:', e.message); process.exit(1); });
