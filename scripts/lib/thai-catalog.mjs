/**
 * Thai catalog ingestion library.
 *
 * The reusable spine behind `derive-set.mjs` and the promo-tail runner.
 * Source connector for the no-API Thai tier: the official site is scraped for
 * Thai name + image + number; the Japanese twin (same set code, language='ja')
 * supplies rarity and any English name. Everything is staged into a changeset
 * file for human approval before `apply-changeset.mjs` touches production.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');

// --- env (quote-stripping, per CLAUDE.md) ---
export function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

export function getSupabase() {
  loadEnv();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// --- text helpers ---
export const THAI = /[฀-๿]/;
export const JP = /[぀-ヿ一-鿿]/;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const padOf = (n) => String(n || '').split('/')[0].trim();          // "001/098" -> "001"
const joinKey = (n) => padOf(n).replace(/^0+/, '') || '0';          // -> "1" (twin match)

// Card-type prefixes the official title prepends; strip so the stored name is clean.
const STAGE_PREFIXES = [/^ร่าง 1\s+/, /^ร่าง 2\s+/, /^พื้นฐาน\s+/, /^VMAX\s+/, /^VSTAR\s+/];
function decodeEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" doesn't double-decode
}
function cleanThaiName(title) {
  let t = decodeEntities((title || '').trim());
  for (const re of STAGE_PREFIXES) t = t.replace(re, '');
  return t.trim();
}

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.text();
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

/**
 * Scrape the official Thai site for one expansion code.
 * Returns [{ number, pad, key, thaiName, imageUrl, detailUrl }].
 */
export async function scrapeThaiSet(code, { maxPages = 40, concurrency = 12 } = {}) {
  // 1. paginate the list view -> detail href + image
  const seen = new Map(); // detailUrl -> imageUrl
  for (let pg = 1; pg <= maxPages; pg++) {
    const html = await fetchText(
      `https://asia.pokemon-card.com/th/card-search/list/?expansionCodes=${encodeURIComponent(code)}&pageNo=${pg}`
    );
    if (!html) break;
    const blocks = [...html.matchAll(/<li class="card">([\s\S]*?)<\/li>/g)];
    if (blocks.length === 0) break;
    for (const b of blocks) {
      const href = b[1].match(/href="([^"]+)"/)?.[1];
      const img = b[1].match(/data-original="([^"]+)"/)?.[1] || null;
      if (href && !seen.has(href)) seen.set(href, img);
    }
  }

  // 2. fetch each detail page -> Thai name + collector number
  const entries = [...seen.entries()];
  const rows = await mapLimit(entries, concurrency, async ([href, img]) => {
    const url = `https://asia.pokemon-card.com${href}`;
    const html = await fetchText(url);
    if (!html) return null;
    const title = html.match(/<title>([^<|]+)\|?/)?.[1];
    const num = html.match(/collectorNumber">\s*([^<]+?)\s*<\/span>/)?.[1]?.trim()
      || html.match(/(\d{1,3}\/[0-9A-Za-z]+)/)?.[1];
    if (!num) return null;
    return {
      number: num,
      pad: padOf(num),
      key: joinKey(num),
      thaiName: cleanThaiName(title),
      imageUrl: img,
      detailUrl: url,
    };
  });

  // de-dupe by collector number (variants share a number; keep first seen)
  const byKey = new Map();
  for (const r of rows) if (r && !byKey.has(r.key)) byKey.set(r.key, r);
  return [...byKey.values()].sort((a, b) => a.pad.localeCompare(b.pad, undefined, { numeric: true }));
}

/** Load the Japanese twin (same set code) keyed by zero-stripped number. */
export async function loadTwin(supabase, code) {
  const { data } = await supabase
    .from('pokemon_cards')
    .select('number, name, english_name, rarity, image_small, image_large')
    .eq('set_id', code)
    .eq('language', 'ja');
  const map = new Map();
  for (const c of data || []) map.set(joinKey(c.number), c);
  return map;
}

export async function getSetMeta(supabase, code) {
  const { data } = await supabase.from('pokemon_sets').select('*').eq('id', code).maybeSingle();
  return data || null;
}

/**
 * Build a changeset: proposed Thai rows from scrape overlaid on twin structure,
 * plus validation and the list of twin numbers the Thai source never confirmed.
 */
export function buildChangeset({ code, scraped, twin, setMeta }) {
  const rows = scraped.map((s) => {
    const t = twin.get(s.key);
    return {
      id: `${code}-${s.pad}-th`,
      set_id: code,
      language: 'th',
      number: s.number,
      name: s.thaiName,
      english_name: t?.english_name ?? null,
      rarity: t?.rarity ?? null,
      image_small: s.imageUrl ?? t?.image_small ?? null,
      image_large: s.imageUrl ?? t?.image_large ?? null,
      _provenance: { name: 'scrape', rarity: t ? 'twin' : null, image: s.imageUrl ? 'scrape' : (t ? 'twin' : null) },
    };
  });

  // validation rules (deterministic gate; nothing auto-applies on failure)
  const errors = [];
  const warnings = [];
  const numbers = rows.map((r) => r.id);
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (dupes.length) errors.push(`duplicate ids: ${[...new Set(dupes)].join(', ')}`);
  for (const r of rows) {
    if (!THAI.test(r.name || '')) warnings.push(`${r.number}: name not Thai ("${r.name}") — possible placeholder`);
    if (!r.image_small) warnings.push(`${r.number}: no image`);
  }
  const expected = setMeta?.printed_total || setMeta?.total || null;
  if (expected && rows.length < expected) {
    warnings.push(`scraped ${rows.length} < expected ${expected} (printed_total)`);
  }

  // twin numbers the Thai site never returned -> review, do NOT clone placeholders
  const scrapedKeys = new Set(scraped.map((s) => s.key));
  const twinOnly = [...twin.keys()].filter((k) => !scrapedKeys.has(k))
    .map((k) => twin.get(k).number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    setId: code,
    generatedAt: new Date().toISOString(),
    sources: { thaiName: 'asia.pokemon-card.com/th', structure: twin.size ? 'ja-twin' : 'scrape-only' },
    setMeta,
    stats: { scraped: scraped.length, twinSize: twin.size, proposed: rows.length, twinOnly: twinOnly.length },
    rows,
    twinOnlyNumbers: twinOnly,
    validation: { errors, warnings },
  };
}

export function writeChangeset(cs) {
  const dir = path.join(ROOT, 'scripts', 'out', 'changesets');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${cs.setId}.json`);
  fs.writeFileSync(file, JSON.stringify(cs, null, 2));
  return file;
}

export function printDiff(cs) {
  const { setId, stats, validation, rows, twinOnlyNumbers } = cs;
  console.log(`\n=== changeset ${setId} ===`);
  console.log(`scraped=${stats.scraped} twin=${stats.twinSize} proposed=${stats.proposed} twinOnly=${stats.twinOnly}`);
  console.log(`sources: name<-${cs.sources.thaiName}, structure<-${cs.sources.structure}`);
  console.log('\nsample rows:');
  for (const r of rows.slice(0, 6)) {
    console.log(`  ${r.number.padEnd(10)} ${(r.name || '').padEnd(22)} rarity=${r.rarity ?? '-'} en=${r.english_name ?? '-'}`);
  }
  if (validation.errors.length) console.log(`\nERRORS (${validation.errors.length}):\n  ` + validation.errors.join('\n  '));
  if (validation.warnings.length) {
    console.log(`\nwarnings (${validation.warnings.length}):`);
    console.log('  ' + validation.warnings.slice(0, 8).join('\n  ') + (validation.warnings.length > 8 ? `\n  ...+${validation.warnings.length - 8} more` : ''));
  }
  if (twinOnlyNumbers.length) console.log(`\ntwin-only (in JA twin, not on Thai site -> review): ${twinOnlyNumbers.join(', ')}`);
}
