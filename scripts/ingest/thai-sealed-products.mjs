// Thai Pokemon sealed products (Booster Box + Booster Pack per main expansion).
//
// PriceCharting has NO Thai category, so there is no direct Thai market price. But
// Thai sets are 1:1 reprints of Japanese sets (same set codes — the same fact the
// english_name backfill relies on), and PriceCharting's pokemon-cards category DOES
// carry Japanese sealed under "Pokemon Japanese <set>" consoles. So each Thai set is
// priced from its JP twin's appreciation:
//
//   price = Thai SRP x max(1, JP box market USD / JP box SRP USD)
//
// The multiplier comes from the JP BOX (the liquid market) and is applied to both the
// Thai box and pack. Floored at SRP: in-print sets read as plain retail. Sets with no
// JP twin in PriceCharting (AS-era etc.) fall back to flat SRP. Keep the constants and
// math in sync with lib/pricecharting.ts (mjs can't import the TS module).
//
// Rows are THB-native (currency='THB'); /api/sealed passes THB through unconverted and
// labels them priceType='estimate' (JP-derived, pricecharting_id = JP box product id)
// or 'srp' (no JP twin, pricecharting_id null). The weekly cron re-derives estimate
// rows from the JP box as its market moves (THB branch in app/api/cron/pricecharting).
//
//   node scripts/ingest/thai-sealed-products.mjs           # DRY: match report, no writes
//   node scripts/ingest/thai-sealed-products.mjs --commit  # upsert rows
//
// Idempotent (upsert on id `th-<setId>-box` / `th-<setId>-pack`).

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

// Keep in sync with lib/pricecharting.ts (THAI_SEALED_SRP_THB / JP_BOOSTER_BOX_SRP_USD).
const BOX_SRP_THB = 1690;
const PACK_SRP_THB = 100;
const JP_BOX_SRP_USD = 38;

// Only MAIN EXPANSIONS are sold in booster boxes/packs. Exclude decks/starters/promos
// and the special products the name rule misses. NB: SC1a/SC1b ARE expansions.
const DECK_NAME_RE = /deck|เด็ค|starter|แท็กติก|คอมแพกต์|การ์ดโปรโมชัน|\bpromo\b/i;
const EXCLUDE_IDS = new Set(['SVHM', 'SVHK', 'SC3a', 'SC3b', 'SH']);
const isDeck = (id, name) => EXCLUDE_IDS.has(id) || DECK_NAME_RE.test(name || '');

// Thai set_id -> JP console name. Hand-curated: pokemon_sets.id is a single-column PK
// (one language per id), so the Thai rows OCCUPY the shared set codes and there is no
// ja row to read the JP English name from — automated matching finds nothing. Mapped
// against the actual JP console list (dump: consoles with a Booster Box price). Thai
// sets sometimes merge a JP main set + subset (SV9s = Battle Partners + Heat Wave
// Arena; SV11s = Black Bolt + White Flare; MA1 = Mega Brave + Mega Symphonia) — those
// anchor to the MAIN/cheaper JP box (conservative). Left at SRP (no confident twin):
// MA2/MA4/MA5 (Mega-era naming unverified), SC1a/SC1b and all AS-era (Thai-exclusive
// compilations with no 1:1 JP box).
const JP_CONSOLE_OVERRIDES = {
  S5I: 'Single Strike Master',
  S5R: 'Rapid Strike Master',
  S5a: 'Matchless Fighter',
  S6h: 'Silver Lance',
  s6k: 'Jet-Black Spirit',
  S6a: 'Eevee Heroes',
  S7R: 'Blue Sky Stream',
  S7D: 'Skyscraping Perfection',
  S8: 'Fusion Arts',
  S8a: '25th Anniversary Collection',
  S8b: 'VMAX Climax',
  S9: 'Star Birth',
  S9a: 'Battle Region',
  S10D: 'Time Gazer',
  S10P: 'Space Juggler',
  S10a: 'Dark Phantasma',
  S10b: 'Go',
  S11: 'Lost Abyss',
  S11a: 'Incandescent Arcana',
  S12: 'Paradigm Trigger',
  S12a: 'VSTAR Universe',
  SV1S: 'Scarlet Ex',
  SV1V: 'Violet Ex',
  SV1a: 'Triplet Beat',
  SV2D: 'Clay Burst',
  SV2P: 'Snow Hazard',
  SV2a: 'Scarlet & Violet 151',
  SV3: 'Ruler of the Black Flame',
  SV3a: 'Raging Surf',
  SV4K: 'Ancient Roar',
  SV4M: 'Future Flash',
  SV4a: 'Shiny Treasure ex',
  SV5K: 'Wild Force',
  SV5M: 'Cyber Judge',
  SV5a: 'Crimson Haze',
  SV6: 'Mask of Change',
  SV7s: 'Stellar Miracle',
  SV8s: 'Super Electric Breaker',
  SV8a: 'Terastal Festival',
  SV9s: 'Battle Partners',
  SV10s: 'Glory of Team Rocket',
  SV11s: 'Black Bolt',
  MA1: 'Mega Symphonia',
  MA3: 'Mega Dream ex',
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const usd = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const isAscii = (s) => /^[\x20-\x7E]+$/.test(s || '');

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

// JP consoles with a Booster Box: normalized console-suffix -> { console, boxUsd, boxId }.
async function loadJpBoxes() {
  const res = await fetch(`${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=pokemon-cards`);
  if (!res.ok) throw new Error(`CSV download ${res.status}`);
  const rows = parseCsv(await res.text());
  const header = rows[0].map((h) => h.trim());
  const products = rows.slice(1).filter((r) => r.length >= header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  if (products[0]?.['console-name'] === '3DO') throw new Error('all-products fallback — wrong slug');

  const byConsole = new Map();
  for (const p of products) {
    const consoleName = p['console-name'] || '';
    if (!/^pokemon japanese/i.test(consoleName)) continue;
    if (!/^booster box\b/i.test((p['product-name'] || '').trim())) continue;
    const boxUsd = usd(p['new-price']) ?? usd(p['cib-price']) ?? usd(p['loose-price']);
    if (!boxUsd) continue;
    const key = norm(consoleName.replace(/^pokemon japanese/i, ''));
    const prev = byConsole.get(key);
    // Multiple box variants ([1st Edition] etc. are excluded by the ^booster box
    // anchor only when suffixed — keep the cheapest as the representative base box.
    if (!prev || boxUsd < prev.boxUsd) byConsole.set(key, { console: consoleName, boxUsd, boxId: String(p.id) });
  }
  return byConsole;
}

function findJpBox(setId, jaName, jpBoxes) {
  const override = JP_CONSOLE_OVERRIDES[setId];
  if (override) {
    const k = norm(override.replace(/^pokemon japanese/i, ''));
    return jpBoxes.get(k) || null;
  }
  if (!jaName || !isAscii(jaName)) return null;
  const target = norm(jaName.replace(/\bex\b/g, '').trim());
  if (!target) return null;
  if (jpBoxes.has(target)) return jpBoxes.get(target);
  // Unique containment fallback (e.g. "terastal festival" vs ja name "terastal fest").
  const hits = [...jpBoxes.entries()].filter(([k]) => k.includes(target) || target.includes(k));
  return hits.length === 1 ? hits[0][1] : null;
}

const estimate = (srp, jpBoxUsd) => Math.round((srp * Math.max(1, jpBoxUsd / JP_BOX_SRP_USD)) / 10) * 10;

async function main() {
  if (!TOKEN) throw new Error('PRICECHARTING_TOKEN missing from .env.local');
  const commit = process.argv.includes('--commit');

  const [{ data: thSets, error: e1 }, { data: jaSets, error: e2 }, jpBoxes] = await Promise.all([
    supabase.from('pokemon_sets').select('id, name, release_date').eq('game', 'pokemon').eq('language', 'th').order('release_date', { ascending: false }),
    supabase.from('pokemon_sets').select('id, name').eq('game', 'pokemon').eq('language', 'ja'),
    loadJpBoxes(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const jaNameById = new Map((jaSets || []).map((s) => [s.id.toLowerCase(), s.name]));
  const expansions = (thSets || []).filter((s) => !isDeck(s.id, s.name));
  console.log(`[thai-sealed] ${thSets.length} Thai sets -> ${expansions.length} expansions | JP consoles with boxes: ${jpBoxes.size}${commit ? '' : '  [DRY]'}`);

  const now = new Date().toISOString();
  const rows = [];
  let derived = 0, srpOnly = 0;
  const unmatched = [];
  console.log('\n  set     JP twin match                                  JP box$   box฿      pack฿');
  for (const s of expansions) {
    const jaName = jaNameById.get(s.id.toLowerCase()) || null;
    const jp = findJpBox(s.id, jaName, jpBoxes);
    const boxThb = jp ? estimate(BOX_SRP_THB, jp.boxUsd) : BOX_SRP_THB;
    const packThb = jp ? estimate(PACK_SRP_THB, jp.boxUsd) : PACK_SRP_THB;
    if (jp) derived++; else { srpOnly++; unmatched.push(`${s.id}${jaName ? ` (ja: ${jaName})` : ' (no ja twin)'}`); }
    console.log(`  ${s.id.padEnd(7)} ${(jp ? jp.console.replace(/^Pokemon Japanese /i, '') : '— SRP fallback').padEnd(45)} ${(jp ? `$${jp.boxUsd}` : '').padStart(8)} ฿${String(boxThb).padStart(6)}  ฿${String(packThb).padStart(5)}`);

    const common = {
      game: 'pokemon', language: 'th', set_id: s.id, image_url: null,
      pricecharting_id: jp ? jp.boxId : null,
      console_name: jp ? jp.console : 'Thai (SRP)',
      loose_price: null, cib_price: null, currency: 'THB', last_updated: now,
    };
    rows.push({ ...common, id: `th-${s.id}-box`, name: 'Booster Box', product_type: 'booster_box', new_price: boxThb });
    rows.push({ ...common, id: `th-${s.id}-pack`, name: 'Booster Pack', product_type: 'booster_pack', new_price: packThb });
  }

  console.log(`\n[thai-sealed] JP-derived: ${derived} sets | SRP-only: ${srpOnly} sets | rows: ${rows.length}`);
  if (unmatched.length) console.log(`[thai-sealed] unmatched (add to JP_CONSOLE_OVERRIDES if a twin exists): ${unmatched.join(' | ')}`);
  if (!commit) { console.log('[thai-sealed] DRY — nothing written. Re-run with --commit.'); return; }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('sealed_products').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[thai-sealed] DONE — upserted ${rows.length} Thai sealed rows`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[thai-sealed] FAILED:', e.message); process.exit(1); });
