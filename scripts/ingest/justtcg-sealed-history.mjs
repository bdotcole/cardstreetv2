// REAL sealed-product price history from JustTCG (TCGplayer market) -> price_snapshots.
//
// Why: sealed charts were flat lines. PriceCharting (the sealed headline) has no
// history API and its sealed prices move rarely, so the daily snapshot cron kept
// writing the same number. JustTCG indexes sealed products (variant condition
// 'Sealed') with 180 days of daily TCGplayer market prices.
//
// Two bridge phases:
//   1. EXACT — by TCGplayer product id, the id in our TCGplayer-hosted packshot
//      URLs (product-images.tcgplayer.com/fit-in/437x437/<id>.jpg). No name
//      matching. PriceCharting occasionally picked a RELATED product's image
//      (a sleeved pack, an art bundle), so a name-compatibility gate rejects
//      case/bundle/sleeved variants of what we sell.
//   2. SEARCH (--search) — for rows phase 1 could not place (PriceCharting-hosted
//      image, or the image belonged to a sibling SKU): JustTCG name search,
//      accepted only when EVERY word of our product name and of our set name
//      appears in the result, the result carries no unexplained qualifier
//      ("half", "sleeved", "mini", a Pokemon-Center bracket...), and exactly
//      one candidate survives.
//
// Either way the series is calibrated onto our headline (factor = PriceCharting
// USD / TCGplayer-now USD, must sit in [0.5, 2.0] or the product is skipped as a
// suspect bridge) so the chart's live "Now" point seams into it; the SHAPE is
// TCGplayer's real day-to-day movement. Every day in the window is written
// (forward-filled) and OVERWRITES the flat PriceCharting rows on those days —
// leaving gap days would saw-tooth the two sources against each other.
//
//   node scripts/ingest/justtcg-sealed-history.mjs                  # dry run
//   node scripts/ingest/justtcg-sealed-history.mjs --commit          # write, exact phase only
//   node scripts/ingest/justtcg-sealed-history.mjs --commit --search # + name search fallback
//   node scripts/ingest/justtcg-sealed-history.mjs --commit --game=lorcana --limit=50 --days=90d
//
// Bridge sources for a row, in order: sealed_products.justtcg_id / tcgplayer_id
// (once 20260916_sealed_justtcg_bridge.sql has run), the live image_url, this
// script's own scripts/out/sealed-justtcg-bridge.json, and the mirror script's
// scripts/ingest/backups/sealed-image-urls-*.json (the pre-mirror URLs — the
// mirror replaces the TCGplayer URL the id was parsed from). The resolved
// bridge is always saved to the JSON and, when the columns exist, to the DB, so
// /api/cron/price-snapshots can keep the series growing nightly. Re-run after
// the migration to populate the columns from the JSON — idempotent.
//
// Request budget: batch POST /v1/cards, 100 items per call, history params per
// item (query-string params are ignored on POST): ~25 calls for phase 1. Phase 2
// is one GET per unplaced row (~1.9k on the first run, then only the JSON-less
// stragglers), throttled to stay under 50 req/min.
//
// Helpers mirror lib/justtcgSealed.ts (this file is plain Node) — change both.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const env = {};
const envPath = ['.env.local', 'C:/Users/brand/Downloads/cardstreet-tcg/.env.local'].find((p) => fs.existsSync(p));
if (!envPath) throw new Error('.env.local not found');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}

const API_KEY = env.JUSTTCG_API_KEY;
const BASE = 'https://api.justtcg.com/v1';
const RATE_MS = 1300;
// Mirrors constants.tsx EXCHANGE_RATES (THB base, USD: 0.028) — change both together.
const THB_PER_USD = 1 / 0.028;
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 2.0;

const COMMIT = process.argv.includes('--commit');
const SEARCH = process.argv.includes('--search');
const argOf = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const DURATION = argOf('days', '180d');
const GAME_FILTER = argOf('game', null);
const MAX_ROWS = parseInt(argOf('limit', '0'), 10) || Infinity;
const BATCH = 100;

const BRIDGE_FILE = path.join('scripts', 'out', 'sealed-justtcg-bridge.json');
const BACKUP_DIR = path.join('scripts', 'ingest', 'backups');

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tcgplayerIdFromUrl(url) {
  if (!url) return null;
  const m = /product-images\.tcgplayer\.com\/(?:[^?#]*\/)?(\d+)\.(?:jpe?g|png|webp)/i.exec(url);
  return m ? m[1] : null;
}

function pickSealedVariant(card) {
  const sealed = (card.variants ?? []).filter((v) => v.condition === 'Sealed');
  if (!sealed.length) return null;
  const score = (v) =>
    (v.printing === 'Normal' ? 100 : 0) + (v.language === 'English' ? 10 : 0) + Math.min(9, (v.priceHistory?.length ?? 0) / 100);
  return [...sealed].sort((a, b) => score(b) - score(a))[0];
}

// The TCGplayer id comes from the packshot PriceCharting chose, occasionally a
// RELATED product's image (a "Sleeved Booster Pack Art Bundle [Set of 3]" on a
// Booster Pack row). A multi-unit or case listing carries a word ours does not.
const MULTI_UNIT_WORDS = ['case', 'set of', 'lot of', 'bundle', 'sleeved'];
function sealedNameCompatible(ourName, jtName) {
  if (!jtName) return true;
  const ours = (ourName ?? '').toLowerCase();
  const theirs = jtName.toLowerCase();
  // "Display" is TCGplayer's word for a Magic booster BOX (36 packs), not a
  // multi-box unit, so a Box row may match a Display listing.
  if (theirs.includes('display') && !ours.includes('display') && !ours.includes('box')) return false;
  return MULTI_UNIT_WORDS.every((w) => !theirs.includes(w) || ours.includes(w));
}

function sealedHeadlineUsd(row) {
  for (const v of [row.new_price, row.cib_price, row.loose_price]) if (typeof v === 'number' && v > 0) return v;
  return null;
}

function variantNowUsd(v) {
  if (typeof v.price === 'number' && v.price > 0) return v.price;
  const h = v.priceHistory ?? [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i]?.p > 0) return h[i].p;
  return null;
}

function calibrationFactor(headlineUsd, jtNowUsd) {
  if (!headlineUsd || !jtNowUsd || jtNowUsd <= 0) return null;
  const f = headlineUsd / jtNowUsd;
  return f >= CALIBRATION_MIN && f <= CALIBRATION_MAX ? f : null;
}

function dailyFilled(history) {
  const byDay = new Map();
  for (const p of history ?? []) {
    if (typeof p?.p !== 'number' || p.p <= 0 || typeof p?.t !== 'number') continue;
    byDay.set(new Date(p.t * 1000).toISOString().slice(0, 10), p.p);
  }
  if (!byDay.size) return [];
  const days = [...byDay.keys()].sort();
  const out = [];
  const lastMs = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  let held = byDay.get(days[0]);
  for (let ms = Date.parse(`${days[0]}T00:00:00Z`); ms <= lastMs; ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    const v = byDay.get(day);
    if (typeof v === 'number') held = v;
    out.push({ day, usd: held });
  }
  return out;
}

function sealedHistoryRows(row, variant, factor) {
  const days = dailyFilled(variant.priceHistory);
  if (days.length < 2) return [];
  return days.map(({ day, usd }) => ({
    subject_id: row.id,
    language: row.language || 'en',
    condition: 'Sealed',
    is_sealed: true,
    market_thb: Math.max(1, Math.round(usd * factor * THB_PER_USD)),
    market_native: usd,
    currency: 'USD',
    source: 'justtcg',
    captured_on: day,
  }));
}

async function jtRequest(url, init) {
  for (let attempt = 0; ; attempt++) {
    await sleep(RATE_MS);
    let res;
    try {
      res = await fetch(url, { ...init, headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    } catch (e) {
      res = { status: 500, ok: false, text: async () => e.message, json: async () => { throw e; } };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(res.status === 429 ? 6000 : 3000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`JustTCG ${res.status}: ${(await res.text()).slice(0, 200)}`);
    try {
      return (await res.json()).data ?? [];
    } catch (e) {
      if (attempt < 3) continue; // truncated body on a 200 (seen on big batches)
      throw e;
    }
  }
}

const batchFetch = (items) => jtRequest(`${BASE}/cards`, { method: 'POST', body: JSON.stringify(items) });

// ── Phase 2 helpers: name + set search ──────────────────────────────────────
const GAME_TO_JT = {
  pokemon: 'pokemon',
  lorcana: 'disney-lorcana',
  mtg: 'magic-the-gathering',
  onepiece: 'one-piece-card-game',
  yugioh: 'yugioh',
  riftbound: 'riftbound-league-of-legends-trading-card-game',
};
function jtGameFor(row) {
  if (row.game === 'pokemon' && (row.language === 'jp' || /japanese/i.test(row.console_name || ''))) return 'pokemon-japan';
  return GAME_TO_JT[row.game] || null;
}
// Words that say nothing about WHICH product it is. Kept short on purpose: a
// dropped word is a word that can no longer disqualify a near-miss.
const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'for', 'to', 'with', 'edition', 'tcg', 'trading', 'card', 'game',
  'disney', 'lorcana', 'pokemon', 'magic', 'gathering', 'mtg', 'yugioh', 'yu', 'gi', 'oh', 'one', 'piece', 'japanese', 'english', 'sealed']);
const tokens = (s) =>
  (s || '').toLowerCase().replace(/[\u2019'`]/g, '').split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t === 'display' ? 'box' : t));
const setNameFromConsole = (consoleName) =>
  (consoleName || '').replace(/^(pokemon|magic|yugioh|one piece|disney lorcana|lorcana)\s+/i, '').replace(/^japanese\s+/i, '');

// Accept only an unambiguous, fully explained match: every word of ours in the
// result, every word of our set in the result (name or set), no leftover word in
// the result's name that neither we nor its set account for. Case/bundle/sleeved
// variants are rejected before any of this.
function pickSearchMatch(row, results) {
  const ourName = tokens(row.name);
  const ourSet = tokens(setNameFromConsole(row.console_name));
  if (!ourName.length) return null;
  const cands = [];
  for (const c of results) {
    if (!pickSealedVariant(c) || !sealedNameCompatible(row.name, c.name)) continue;
    const cName = tokens(c.name);
    const cSet = tokens(c.set_name);
    const cAll = new Set([...cName, ...cSet]);
    if (!ourName.every((t) => cAll.has(t))) continue;
    if (!ourSet.every((t) => cAll.has(t))) continue;
    const extras = cName.filter((t) => !ourName.includes(t) && !ourSet.includes(t) && !cSet.includes(t) && !/^\d+$/.test(t));
    if (extras.length) continue;
    cands.push(c);
  }
  return cands.length === 1 ? cands[0] : null;
}

function loadBridgeSources() {
  const bridge = fs.existsSync(BRIDGE_FILE) ? JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8')) : {};
  const backupUrls = {};
  if (fs.existsSync(BACKUP_DIR)) {
    for (const f of fs.readdirSync(BACKUP_DIR).filter((n) => /^sealed-image-urls-.*\.json$/.test(n)).sort()) {
      try {
        Object.assign(backupUrls, JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8')));
      } catch (_e) { /* a corrupt backup is not this script's problem */ }
    }
  }
  return { bridge, backupUrls };
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing from .env.local');
  console.log(COMMIT ? '== COMMIT run ==' : '== DRY RUN (pass --commit to write) ==');
  console.log(`duration=${DURATION} game=${GAME_FILTER ?? 'all'} limit=${Number.isFinite(MAX_ROWS) ? MAX_ROWS : 'none'} search=${SEARCH}`);

  // Bridge columns exist only after 20260916_sealed_justtcg_bridge.sql.
  const probe = await supabase.from('sealed_products').select('id, justtcg_id, tcgplayer_id').limit(1);
  const hasCols = !probe.error;
  console.log(hasCols ? 'bridge columns present: DB will be updated' : 'bridge columns ABSENT (run the 20260916 migration): bridge saved to JSON only');

  const { bridge, backupUrls } = loadBridgeSources();

  // All non-Thai sealed rows (Thai rows are JP-twin estimates with no TCGplayer twin).
  const rows = [];
  let cursor = '';
  for (;;) {
    let q = supabase
      .from('sealed_products')
      .select(`id, game, language, name, console_name, image_url, currency, loose_price, cib_price, new_price${hasCols ? ', justtcg_id, tcgplayer_id' : ''}`)
      .neq('currency', 'THB')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(1000);
    if (GAME_FILTER) q = q.eq('game', GAME_FILTER);
    const { data, error } = await q;
    if (error) throw new Error(`select: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    cursor = data[data.length - 1].id;
  }

  const summary = { rows: rows.length, noHeadline: 0, noBridge: 0, lookups: 0, matched: 0, noSealedVariant: 0, nameMismatch: 0,
    skippedCalibration: 0, points: 0, apiCalls: 0, bridgedNew: 0, dbBridgeWrites: 0,
    searched: 0, searchMatched: 0, searchAmbiguousOrNone: 0 };
  const calibrationSkips = [];
  const nameSkips = [];
  const placed = new Set(); // rows a JustTCG sealed product was found for (calibration aside)

  // Takes the cards a batch returned for `chunk` ({row, justtcgId, tcgplayerId}),
  // records the bridge, and returns the calibrated snapshot rows to write.
  const absorb = async (cards, chunk) => {
    const byJt = new Map(chunk.filter((c) => c.justtcgId).map((c) => [c.justtcgId, c]));
    const byTcg = new Map(chunk.filter((c) => !c.justtcgId).map((c) => [String(c.tcgplayerId), c]));
    const snapshotRows = [];
    const bridgeWrites = [];
    for (const card of cards) {
      const tid = card.tcgplayerId == null ? null : String(card.tcgplayerId);
      const hit = byJt.get(card.id) || (tid ? byTcg.get(tid) : undefined);
      if (!hit) continue;
      const variant = pickSealedVariant(card);
      if (!variant) { summary.noSealedVariant++; continue; }
      if (!sealedNameCompatible(hit.row.name, card.name)) {
        summary.nameMismatch++;
        nameSkips.push(`${hit.row.id} ${hit.row.console_name} / ${hit.row.name}  ->  ${card.name}`);
        continue;
      }
      placed.add(hit.row.id);
      summary.matched++;
      if (!hit.justtcgId || hit.justtcgId !== card.id) summary.bridgedNew++;
      bridge[hit.row.id] = { justtcgId: card.id, tcgplayerId: tid ?? hit.tcgplayerId ?? null, name: card.name ?? null, via: hit.via ?? 'exact' };
      if (hasCols && (hit.row.justtcg_id !== card.id || (tid && hit.row.tcgplayer_id !== tid))) {
        bridgeWrites.push({ id: hit.row.id, justtcg_id: card.id, tcgplayer_id: tid ?? hit.tcgplayerId ?? null });
      }
      const factor = calibrationFactor(sealedHeadlineUsd(hit.row), variantNowUsd(variant));
      if (factor == null) {
        summary.skippedCalibration++;
        calibrationSkips.push(`${hit.row.id} ${hit.row.console_name} / ${hit.row.name}: PC $${sealedHeadlineUsd(hit.row)} vs TCG $${variantNowUsd(variant)} (${card.name})`);
        continue;
      }
      snapshotRows.push(...sealedHistoryRows(hit.row, variant, factor));
    }
    summary.points += snapshotRows.length;
    if (COMMIT) {
      for (let j = 0; j < snapshotRows.length; j += 500) {
        const { error } = await supabase
          .from('price_snapshots')
          .upsert(snapshotRows.slice(j, j + 500), { onConflict: 'subject_id,language,condition,captured_on' });
        if (error) throw new Error(`upsert: ${error.message}`);
      }
      for (const w of bridgeWrites) {
        const { error } = await supabase.from('sealed_products').update({ justtcg_id: w.justtcg_id, tcgplayer_id: w.tcgplayer_id }).eq('id', w.id);
        if (error) console.log(`  bridge write failed for ${w.id}: ${error.message}`);
        else summary.dbBridgeWrites++;
      }
      fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true });
      fs.writeFileSync(BRIDGE_FILE, JSON.stringify(bridge, null, 1));
    }
  };

  const historyItem = (c) =>
    c.justtcgId
      ? { cardId: c.justtcgId, include_price_history: true, priceHistoryDuration: DURATION }
      : { tcgplayerId: c.tcgplayerId, include_price_history: true, priceHistoryDuration: DURATION };

  const runBatches = async (todo, label) => {
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      let cards;
      try {
        cards = await batchFetch(chunk.map(historyItem));
      } catch (e) {
        console.log(`  [${label} batch ${i / BATCH}] FAILED: ${e.message}`);
        continue;
      }
      summary.apiCalls++;
      await absorb(cards, chunk);
      console.log(`${COMMIT ? 'WRITE' : 'PLAN '} ${label} ${Math.min(i + BATCH, todo.length)}/${todo.length}, matched=${summary.matched}, points=${summary.points}, calib-skips=${summary.skippedCalibration}, api=${summary.apiCalls}`);
    }
  };

  // ── Phase 1: exact bridge (known JustTCG id, else TCGplayer id) ───────────────
  const exact = [];
  const unplaced = [];
  for (const row of rows) {
    if (!sealedHeadlineUsd(row)) { summary.noHeadline++; continue; }
    const saved = bridge[row.id] || {};
    const justtcgId = row.justtcg_id || saved.justtcgId || null;
    const tcgplayerId =
      row.tcgplayer_id || saved.tcgplayerId || tcgplayerIdFromUrl(row.image_url) || tcgplayerIdFromUrl(backupUrls[row.id]) || null;
    if (!justtcgId && !tcgplayerId) { summary.noBridge++; unplaced.push(row); continue; }
    exact.push({ row, justtcgId, tcgplayerId, via: saved.via });
  }
  const todo = exact.slice(0, MAX_ROWS);
  summary.lookups = todo.length;
  console.log(`rows=${rows.length} headline-less=${summary.noHeadline} unbridgeable=${summary.noBridge} exact look-ups=${todo.length}`);
  await runBatches(todo, 'exact');

  // ── Phase 2: name + set search for whatever phase 1 could not place ─────────
  if (SEARCH) {
    const pending = [...unplaced, ...todo.filter((c) => !placed.has(c.row.id)).map((c) => c.row)].slice(0, MAX_ROWS);
    console.log(`search phase: ${pending.length} rows`);
    const found = [];
    for (const row of pending) {
      const game = jtGameFor(row);
      if (!game) continue;
      summary.searched++;
      const q = `${setNameFromConsole(row.console_name)} ${row.name}`.replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      let results;
      try {
        results = await jtRequest(`${BASE}/cards?game=${encodeURIComponent(game)}&q=${encodeURIComponent(q)}&limit=12`);
      } catch (e) {
        console.log(`  [search] ${row.id} FAILED: ${e.message}`);
        continue;
      }
      summary.apiCalls++;
      const hit = pickSearchMatch(row, results);
      if (!hit) { summary.searchAmbiguousOrNone++; continue; }
      summary.searchMatched++;
      found.push({ row, justtcgId: hit.id, tcgplayerId: hit.tcgplayerId == null ? null : String(hit.tcgplayerId), via: 'search' });
      if (summary.searched % 50 === 0) console.log(`  searched ${summary.searched}/${pending.length}, found ${found.length}`);
    }
    await runBatches(found, 'search');
  }

  console.log('done:', JSON.stringify(summary));
  if (nameSkips.length) {
    console.log(`\nname-mismatch skips (${nameSkips.length}) — TCGplayer product is a case/bundle/sleeved variant of ours:`);
    for (const s of nameSkips.slice(0, 60)) console.log('  ' + s);
  }
  if (calibrationSkips.length) {
    console.log(`\ncalibration skips (${calibrationSkips.length}) — headline vs TCGplayer outside [${CALIBRATION_MIN}, ${CALIBRATION_MAX}]:`);
    for (const s of calibrationSkips.slice(0, 60)) console.log('  ' + s);
  }
  if (COMMIT) console.log(`bridge saved to ${BRIDGE_FILE}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
