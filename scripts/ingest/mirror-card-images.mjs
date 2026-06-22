/**
 * Mirror catalog card images from third-party hosts into our own Supabase
 * storage so card art is always available even when an upstream host (TCGdex,
 * optcgapi, ygoprodeck, ...) is down or rate-limited.
 *
 * For each row whose image is NOT already on Supabase, we fetch the best
 * source image once, re-encode to two pre-sized WebP variants with sharp
 * (small for grids, large for detail), upload both to the `card-images`
 * bucket, and repoint pokemon_cards.image_small / image_large at them.
 *
 * The originals remain recoverable from pokemon_cards.raw_data, so the repoint
 * is reversible.
 *
 *   node scripts/ingest/mirror-card-images.mjs [--language=en] [--game=pokemon]
 *        [--host=tcgdex] [--limit=100] [--concurrency=10] [--force] [--dry]
 *
 * Idempotent  — rows already pointing at supabase.co are skipped (unless --force).
 * Resumable   — paginates by id cursor; safe to ctrl-c and re-run.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
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
const LANGUAGE = args.language ?? null;
const GAME = args.game ?? null;
const HOST = args.host ?? null;           // substring filter on the source URL
const LIMIT = parseInt(args.limit ?? '0', 10) || Infinity;
const CONCURRENCY = parseInt(args.concurrency ?? '10', 10);
const FORCE = !!args.force;
const DRY = !!args.dry;
const PAGE_SIZE = 500;
const BUCKET = 'card-images';

// Pre-sized variant geometry. small feeds the grid (perf memory: thumbnail with
// a genuinely small file, never the large one); large feeds the detail hero.
const SMALL_W = 245, SMALL_Q = 78;
const LARGE_W = 734, LARGE_Q = 82;

function sourceUrl(row) {
  let u = row.image_large || row.image_small;
  if (!u) return null;
  // TCGdex stores extension-less base URLs (".../151/high"); the asset host
  // serves .webp at that path.
  if (u.includes('tcgdex.net') && !/\.(png|jpg|jpeg|webp)$/i.test(u)) u += '.webp';
  return u;
}

async function fetchBuffer(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'cardstreet-image-mirror/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return fetchBuffer(url, attempt + 1);
    }
    throw e;
  }
}

async function uploadWebp(objectPath, buf) {
  const { error } = await supabase.storage
    .from(BUCKET)
    // Card art is immutable once published, so cache it for a year. Without this
    // Supabase defaults objects (and the render endpoint that serves them) to
    // max-age=3600, so thumbnails keep aging out of the Cloudflare edge and get
    // re-transformed — the storage-CDN analog of next.config's minimumCacheTTL.
    .upload(objectPath, buf, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

async function processRow(row) {
  const src = sourceUrl(row);
  if (!src) return { status: 'skip-no-url' };
  try {
    const original = await fetchBuffer(src);
    // withoutEnlargement: never upscale a source smaller than our target width.
    const [largeBuf, smallBuf] = await Promise.all([
      sharp(original).resize({ width: LARGE_W, withoutEnlargement: true }).webp({ quality: LARGE_Q }).toBuffer(),
      sharp(original).resize({ width: SMALL_W, withoutEnlargement: true }).webp({ quality: SMALL_Q }).toBuffer(),
    ]);
    if (DRY) return { status: 'ok', bytes: largeBuf.length + smallBuf.length };

    const largeUrl = await uploadWebp(`${row.id}/large.webp`, largeBuf);
    const smallUrl = await uploadWebp(`${row.id}/small.webp`, smallBuf);
    const { error } = await supabase
      .from('pokemon_cards')
      .update({ image_small: smallUrl, image_large: largeUrl })
      .eq('id', row.id);
    if (error) throw new Error(`db: ${error.message}`);
    return { status: 'ok', bytes: largeBuf.length + smallBuf.length };
  } catch (e) {
    return { status: 'fail', error: e.message };
  }
}

async function fetchPage(lastId) {
  let q = supabase
    .from('pokemon_cards')
    .select('id, image_small, image_large, language, game')
    .not('image_small', 'is', null)
    .order('id', { ascending: true })
    .limit(PAGE_SIZE);
  if (!FORCE) q = q.not('image_small', 'ilike', '%supabase.co%');
  if (lastId) q = q.gt('id', lastId);
  if (LANGUAGE) q = q.eq('language', LANGUAGE);
  if (GAME) q = q.eq('game', GAME);
  if (HOST) q = q.ilike('image_small', `%${HOST}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['image/webp'],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(`created public bucket "${BUCKET}"`);
}

async function main() {
  console.log('card-image mirror');
  console.log(`  filters: language=${LANGUAGE ?? '(all)'} game=${GAME ?? '(all)'} host=${HOST ?? '(any non-supabase)'}`);
  console.log(`  limit=${LIMIT === Infinity ? '(unlimited)' : LIMIT} conc=${CONCURRENCY} force=${FORCE} dry=${DRY}`);
  await ensureBucket();

  const counts = { ok: 0, fail: 0, 'skip-no-url': 0 };
  let dispatched = 0, done = 0, bytes = 0, lastId = '';
  const t0 = Date.now();

  while (dispatched < LIMIT) {
    const page = await fetchPage(lastId);
    if (page.length === 0) break;

    const inflight = new Set();
    for (const row of page) {
      if (dispatched >= LIMIT) break;
      if (inflight.size >= CONCURRENCY) await Promise.race(inflight);
      dispatched++;
      const p = processRow(row).then((res) => {
        counts[res.status] = (counts[res.status] || 0) + 1;
        done++;
        bytes += res.bytes || 0;
        if (res.status === 'fail') console.warn(`  fail ${row.id}: ${res.error}`);
        if (done % 100 === 0) {
          const rate = done / ((Date.now() - t0) / 1000);
          const mb = (bytes / 1e6).toFixed(0);
          console.log(`  ${done} | ok=${counts.ok} fail=${counts.fail} skip=${counts['skip-no-url']} | ${rate.toFixed(1)}/s | ${mb}MB`);
        }
        inflight.delete(p);
      });
      inflight.add(p);
    }
    await Promise.all(inflight);

    lastId = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDone in ${elapsed}s. ok=${counts.ok} fail=${counts.fail} skip=${counts['skip-no-url']} | ${(bytes / 1e6).toFixed(0)}MB`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
