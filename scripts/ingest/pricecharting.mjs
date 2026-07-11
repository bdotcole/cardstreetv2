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
//
// There is NO working pokemon-japanese-cards category (every slug variant returns the
// all-products fallback) — Japanese cards live INSIDE the pokemon-cards CSV under
// "Pokemon Japanese <set>" console names (31k card rows / ~390 consoles). The two
// Pokemon ingests therefore share one CSV, partitioned by consoleRe/consoleExcludeRe.
// The exclude on the EN run is load-bearing: EN set names collide with prefix-stripped
// JP console names ("Pokemon Japanese Rebel Clash" -> 'rebel clash' = EN swsh2), which
// once mis-mapped 404 EN cards to JP products before the filters existed (2026-07-03).
// One Piece follows the same shared-CSV pattern: JP products live inside
// one-piece-cards under "One Piece Japanese <set>" console names (there is no
// working one-piece-japanese-cards category either). The JP CATALOG + prices are
// primarily owned by scripts/ingest/onepiece-jp.mjs (exact product pairing, no
// fuzzy matching); the onepiece-jp entry here exists for the sealed run and for
// graded re-runs. The exclude + lang on the EN entry are load-bearing once ja
// rows exist, same as the Pokemon partition.
const GAME_CONFIG = {
  pokemon:      { game: 'pokemon',  lang: 'en', marketLang: 'en', category: 'pokemon-cards', consoleExcludeRe: /^pokemon japanese\b/i },
  'pokemon-jp': { game: 'pokemon',  lang: 'ja', marketLang: 'jp', category: 'pokemon-cards', consoleRe: /^pokemon japanese\b/i },
  mtg:          { game: 'mtg',      lang: null, marketLang: 'en', category: 'magic-cards' },
  yugioh:       { game: 'yugioh',   lang: null, marketLang: 'en', category: 'yugioh-cards' },
  onepiece:     { game: 'onepiece', lang: 'en', marketLang: 'en', category: 'one-piece-cards', consoleExcludeRe: /^one piece japanese\b/i },
  'onepiece-jp': { game: 'onepiece', lang: 'ja', marketLang: 'jp', category: 'one-piece-cards', consoleRe: /^one piece japanese\b/i },
  lorcana:      { game: 'lorcana',  lang: null, marketLang: 'en', category: 'lorcana-cards' },
};

// PriceCharting console-name -> our set_id, for sets whose names don't normalize-match.
// Keyed per ingest game (a bare key like 'jungle' means JP Jungle on the pokemon-jp
// run but must NOT hijack the EN "Pokemon Jungle" console on the pokemon run).
// Keys are norm(stripGamePrefix(console-name)). Fill from the "unresolved
// console-name" warnings the script prints.
const SET_NAME_OVERRIDES = {
  pokemon: {
    // 'scarlet violet 151': 'sv2a',
  },
  // Our ja pokemon_sets mostly carry Japanese names; PriceCharting consoles use the
  // English set names, so all non-SV-era sets map by hand (verified against the
  // console list in the CSV, 2026-07-03).
  'pokemon-jp': {
    'expedition expansion pack': 'E1',
    'the town on no map': 'E2',
    'wind from the sea': 'E3',
    'split earth': 'E4',
    'mysterious mountains': 'E5',
    'gold silver new world': 'neo1',
    'crossing the ruins': 'neo2',
    'awakening legends': 'neo3',
    'darkness and to light': 'neo4',
    'flight of legends': 'PCG1',
    'clash of the blue sky': 'PCG2',
    'rocket gang strikes back': 'PCG3',
    'golden sky silvery ocean': 'PCG4',
    'mirage forest': 'PCG5',
    'holon research': 'PCG6',
    'holon phantom': 'PCG7',
    'miracle crystal': 'PCG8',
    'offense and defense of the furthest ends': 'PCG9',
    'expansion pack': 'PMCG1',
    'jungle': 'PMCG2',
    'mystery of the fossils': 'PMCG3',
    'rocket gang': 'PMCG4',
    'leaders stadium': 'PMCG5',
    'challenge from the darkness': 'PMCG6',
    'glory of team rocket': 'SV10',
    'stellar miracle deck build box': 'SVK',
    'stellar tera starter set sylveon ex': 'SVLN',
    'stellar tera starter set ceruledge ex': 'SVLS',
    'vs': 'VS1',
    'web': 'web1',
  },
};

// Card detection + sealed classification — MUST stay in sync with lib/pricecharting.ts.
// A card gate runs first so card names with sealed-sounding words ("[Tin Topper] #3",
// "Tin Goldfish", "Iron Bundle #66") are rejected instead of filed as sealed.
const CARD_NUMBER_RE = /#\s*[A-Za-z]{0,5}\d{1,4}\b/;
const CARD_SETCODE_RE = /\b[A-Z]{1,5}\d{0,2}-[A-Z]{0,4}\d{1,4}[a-z]?\b\s*$/;
const CONTAINER_HEAD_RE = /^\s*(sealed\s+|factory\s+sealed\s+)?(booster box|booster pack|booster bundle|elite trainer box|\betb\b|double pack|triple pack|build\s*&?\s*battle|starter deck|structure deck|prerelease|bundle box|display box|booster case)\b/i;
const CARD_VARIANT_RE = /\[(foil|non-?foil[^\]]*|etched[^\]]*|extended art|borderless|showcase|retro frame|full art|alt(?:ernate)? art|[^\]]*\bfoil\b|serial(?:ized)?|prize pack[^\]]*|tin topper|box topper|storage box set[^\]]*|illustration box[^\]]*|dash pack|welcome pack[^\]]*|master ball|poke ball|reverse holo)\]/i;

function looksLikeCardProductName(name) {
  const n = name || '';
  if (CARD_VARIANT_RE.test(n)) return true;
  return (CARD_NUMBER_RE.test(n) || CARD_SETCODE_RE.test(n)) && !CONTAINER_HEAD_RE.test(n);
}

const SEALED_KEYWORDS = [
  [/elite trainer box|\betb\b/i, 'etb'],
  [/booster box|booster case|display box/i, 'booster_box'],
  [/booster bundle|booster pack|sleeved booster|\bblister\b|fat pack|\bpack\b/i, 'booster_pack'],
  [/\bbundle\b|build\s*&?\s*battle|prerelease|\bjumpstart\b|toolkit/i, 'bundle'],
  [/starter deck|structure deck|commander deck|theme deck|planeswalker deck|challenger deck|battle deck|deck box|deckbuilder|\bdeck\b/i, 'other'],
  [/\bcollection\b|\btin\b|premium|box set|\bgift\b|\btrove\b|portfolio|\bbinder\b|\bcalendar\b|advent|checklane|storage box|\bbox\b/i, 'collection'],
];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Numerator only ("056/071" -> "56"): EN numbers have no slash (no-op), but some
// catalogs store the printed total.
const normNum = (s) => String(s || '').split('/')[0].toLowerCase().replace(/(\D)0+(?=\d)/, '$1').replace(/^0+(?=\d)/, '');
// The bulk CSV formats prices as dollar strings ("$1,234.50") — NOT the integer
// cents the JSON product API returns. This script reads the CSV, so parse dollars.
const usd = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

function classifySealed(productName) {
  const name = productName || '';
  if (looksLikeCardProductName(name)) return null; // single card, not sealed
  for (const [re, type] of SEALED_KEYWORDS) if (re.test(name)) return type;
  return null;
}

function stripGamePrefix(consoleName) {
  return (consoleName || '')
    .replace(/^pokemon japanese/i, '')
    .replace(/^pokemon/i, '')
    .replace(/^magic[:\- ]*the gathering/i, '')
    .replace(/^magic/i, '')
    .replace(/^yu-?gi-?oh!?/i, '')
    .replace(/^one piece japanese/i, '')
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
  const namesById = new Map();// card id -> [normed name, normed english_name]
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
      const normedNames = [];
      for (const nm of [c.name, c.english_name]) {
        if (nm) {
          const n = norm(nm);
          if (n) normedNames.push(n);
          const k = `${c.set_id}|${n}`;
          if (n && !byName.has(k)) byName.set(k, c.id);
        }
      }
      if (normedNames.length) namesById.set(c.id, normedNames);
      const setName = c.pokemon_sets?.name;
      if (setName) setByName.set(norm(setName), c.set_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return { byNumber, byName, namesById, setByName };
}

// Small edit distance for PriceCharting typos ("Dreadnaw", "Killowattrel").
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Do a PriceCharting product name and one of our card names refer to the same card?
// Exact, token-wise containment (PC adds qualifiers), or a typo-sized edit distance.
function namesAgree(pcName, ourNames) {
  for (const our of ourNames || []) {
    if (!our) continue;
    if (pcName === our) return true;
    if (pcName.startsWith(our + ' ') || pcName.endsWith(' ' + our) || pcName.includes(' ' + our + ' ')) return true;
    if (our.startsWith(pcName + ' ') || our.endsWith(' ' + pcName) || our.includes(' ' + pcName + ' ')) return true;
    if (lev(pcName, our) <= (our.length > 6 ? 2 : 1)) return true;
  }
  return false;
}

// A product is in scope for this ingest run only if its console passes the game's
// include/exclude filters (the two Pokemon runs partition one shared CSV).
function consoleInScope(cfg, consoleName) {
  const c = consoleName || '';
  if (cfg.consoleRe && !cfg.consoleRe.test(c)) return false;
  if (cfg.consoleExcludeRe && cfg.consoleExcludeRe.test(c)) return false;
  return true;
}

function resolveSetId(ingestGame, consoleName, setByName) {
  const key = norm(stripGamePrefix(consoleName));
  return SET_NAME_OVERRIDES[ingestGame]?.[key] || setByName.get(key) || null;
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
  let cards = 0, matched = 0, nameGated = 0, numberUntrusted = 0;
  const unresolvedSets = new Set();

  // Shared product parse for both passes.
  const parse = (p) => {
    const pname = p['product-name'] || '';
    if (!consoleInScope(cfg, p['console-name']) || classifySealed(pname)) return null;
    // Extract collector number + clean name. Pokemon/Magic/Lorcana print "#123";
    // One Piece / Yu-Gi-Oh print a trailing set code ("OP07-002", "LOB-EN001").
    let rawNum = null, namePart = pname;
    const hash = /#\s*([A-Za-z0-9]+)/.exec(pname);
    if (hash) { rawNum = hash[1]; namePart = pname.slice(0, hash.index); }
    else {
      const code = /\s([A-Za-z0-9]+-[A-Za-z0-9]+)\s*$/.exec(pname);
      if (code) { rawNum = code[1]; namePart = pname.slice(0, code.index); }
    }
    const setId = resolveSetId(cfg.ingestGame, p['console-name'], idx.setByName);
    // Strip card-variant brackets ("[Reverse Holo]") before name comparison.
    const name = norm(namePart.replace(/\[[^\]]*\]/g, ''));
    return { pname, rawNum, name, setId, consoleName: p['console-name'] };
  };

  // Pass 1: per-set, how often does a number-hit AGREE on name? Some catalogs use a
  // different numbering scheme than PriceCharting (vintage JP PMCG*/neo* are numbered
  // by Pokedex there), which makes every number match a random pairing. A set must
  // EARN number-matching; where it fails, only name matches are used — critically,
  // this also blocks unverifiable number-hits (cards with no english name) in broken
  // sets, which pass 2's per-row gate cannot see.
  const setAgree = new Map(); // setId -> { ok, bad }
  for (const p of products) {
    const parsed = parse(p);
    if (!parsed || !parsed.setId || !parsed.rawNum || !parsed.name) continue;
    const hit = idx.byNumber.get(`${parsed.setId}|${normNum(parsed.rawNum)}`);
    if (!hit || !idx.namesById.has(hit)) continue;
    const s = setAgree.get(parsed.setId) || { ok: 0, bad: 0 };
    if (namesAgree(parsed.name, idx.namesById.get(hit))) s.ok++; else s.bad++;
    setAgree.set(parsed.setId, s);
  }
  const numberTrusted = (setId) => {
    const s = setAgree.get(setId);
    // No verifiable pairs at all -> distrust numbering (nothing proves it lines up).
    if (!s || s.ok + s.bad < 5) return false;
    return s.bad / (s.ok + s.bad) <= 0.1;
  };
  const distrusted = [...setAgree.entries()].filter(([id]) => !numberTrusted(id));
  if (distrusted.length) {
    console.log('[pc:graded] number-matching DISTRUSTED (name-only) in:',
      distrusted.map(([id, s]) => `${id}(${s.bad}/${s.ok + s.bad} disagree)`).join(' '));
  }

  // Pass 2: match + collect rows.
  for (const p of products) {
    const parsed = parse(p);
    if (!parsed) continue;
    const { pname, rawNum, name, setId } = parsed;
    if (!setId) { unresolvedSets.add(parsed.consoleName); continue; }
    cards++;
    let cardId;
    if (rawNum && numberTrusted(setId)) {
      cardId = idx.byNumber.get(`${setId}|${normNum(rawNum)}`);
      // Even in a trusted set, a number hit must not contradict the name.
      if (cardId && name && idx.namesById.has(cardId) && !namesAgree(name, idx.namesById.get(cardId))) {
        nameGated++;
        cardId = undefined;
      }
    } else if (rawNum) {
      numberUntrusted++;
    }
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
  console.log(`[pc:graded] CSV cards: ${cards}, matched rows: ${matched}, distinct cards: ${mapRows.length}, graded rows: ${mvRows.length}, name-gated: ${nameGated}, number-hits skipped in distrusted sets: ${numberUntrusted}`);
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
    if (!consoleInScope(cfg, p['console-name'])) continue;
    const type = classifySealed(p['product-name']);
    if (!type) continue;
    found++;
    const setId = resolveSetId(cfg.ingestGame, p['console-name'], idx.setByName);
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
  cfg.ingestGame = game;

  console.log(`[pc] ${mode} ${game} (category=${cfg.category})${dry ? ' [DRY]' : ''}${setFilter ? ` set=${setFilter}` : ''}`);
  const [products, idx] = await Promise.all([downloadCsv(cfg.category), loadCatalog(cfg, setFilter)]);
  console.log(`[pc] CSV products: ${products.length}, catalog sets: ${idx.setByName.size}`);

  if (mode === 'graded') await runGraded(cfg, products, idx, dry, limit);
  else await runSealed(cfg, products, idx, dry, limit);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[pc] FAILED:', e.message); process.exit(1); });
