/**
 * Backfill perceptual hashes (dHash) for every pokemon_cards row.
 *
 * Usage:
 *   npm install -D sharp @supabase/supabase-js
 *   node scripts/backfill-phashes.mjs [--limit=1000] [--force] [--language=en]
 *
 * Idempotent — skips rows that already have a phash unless --force is passed.
 * Resumable — safe to ctrl-c and re-run; in-flight rows just get retried.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const LIMIT = parseInt(args.limit ?? '0', 10) || Infinity;
const FORCE = !!args.force;
const LANGUAGE = args.language ?? null;
const CONCURRENCY = parseInt(args.concurrency ?? '8', 10);
const PAGE_SIZE = 500;

// --- URL normalization, matching pokemonService.mapSupabaseCardToInternal ---
function resolveImageUrl(row) {
  const fixTcgdex = (url) => {
    if (!url) return null;
    if (url.includes('tcgdex.net') && !/\.(png|jpg|jpeg|webp)$/i.test(url)) return `${url}.png`;
    return url;
  };
  if (row.image_large) return fixTcgdex(row.image_large);
  if (row.image_small) return fixTcgdex(row.image_small);
  const raw = row.raw_data || {};
  if (raw.images?.large) return raw.images.large;
  if (raw.images?.small) return raw.images.small;
  if (raw.image) {
    const base = raw.image.includes('http') ? raw.image : `${raw.image}/high`;
    return fixTcgdex(base);
  }
  return null;
}

// --- dHash: 9x8 grayscale, compare adjacent pixels per row -> 64 bits ---
async function computeDHash(imageBuffer) {
  const buf = await sharp(imageBuffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  // 9 cols × 8 rows = 72 grayscale bytes
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = buf[row * 9 + col];
      const right = buf[row * 9 + col + 1];
      if (left > right) byte |= 1 << (7 - col);
    }
    hash[row] = byte;
  }
  return hash;
}

async function fetchImage(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'cardstreet-phash-backfill/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      return fetchImage(url, attempt + 1);
    }
    throw e;
  }
}

async function processRow(row) {
  const url = resolveImageUrl(row);
  if (!url) return { id: row.id, status: 'skip-no-url' };
  try {
    const imageBuffer = await fetchImage(url);
    const hash = await computeDHash(imageBuffer);
    // Supabase serializes bytea as \x-prefixed hex when sent as string.
    const hex = '\\x' + hash.toString('hex');
    const { error } = await supabase.from('pokemon_cards').update({ phash: hex }).eq('id', row.id);
    if (error) throw error;
    return { id: row.id, status: 'ok' };
  } catch (e) {
    return { id: row.id, status: 'fail', error: e.message };
  }
}

async function fetchPage(lastId, take) {
  // Always paginate by id, regardless of mode. In non-force mode we ALSO require
  // `phash IS NULL` so already-hashed rows don't reappear — but the id cursor is
  // what stops us from looping forever on skip-no-url rows (which keep their NULL
  // phash but can never be hashed).
  let q = supabase
    .from('pokemon_cards')
    .select('id, image_small, image_large, raw_data, language')
    .order('id', { ascending: true })
    .limit(take);
  if (!FORCE) q = q.is('phash', null);
  if (lastId) q = q.gt('id', lastId);
  if (LANGUAGE) q = q.eq('language', LANGUAGE);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function main() {
  console.log(`pHash backfill starting`);
  console.log(`  language: ${LANGUAGE ?? '(all)'}`);
  console.log(`  force:    ${FORCE}`);
  console.log(`  limit:    ${LIMIT === Infinity ? '(unlimited)' : LIMIT}`);
  console.log(`  conc:     ${CONCURRENCY}`);
  console.log('');

  const counts = { ok: 0, fail: 0, 'skip-no-url': 0 };
  let total = 0;
  let lastId = '';
  const t0 = Date.now();

  while (total < LIMIT) {
    const take = Math.min(PAGE_SIZE, LIMIT - total);
    const page = await fetchPage(lastId, take);
    if (page.length === 0) break;

    const inflight = new Set();
    const wait = async () => {
      if (inflight.size >= CONCURRENCY) await Promise.race(inflight);
    };

    for (const row of page) {
      await wait();
      const p = processRow(row).then((res) => {
        counts[res.status] = (counts[res.status] || 0) + 1;
        total++;
        if (res.status === 'fail') console.warn(`  fail ${res.id}: ${res.error}`);
        if (total % 100 === 0) {
          const rate = total / ((Date.now() - t0) / 1000);
          console.log(`  ${total} processed | ok=${counts.ok} fail=${counts.fail} skip=${counts['skip-no-url']} | ${rate.toFixed(1)}/s`);
        }
        inflight.delete(p);
      });
      inflight.add(p);
    }
    await Promise.all(inflight);

    lastId = page[page.length - 1].id;
    if (page.length < take) break;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s. ok=${counts.ok} fail=${counts.fail} skip=${counts['skip-no-url']}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
