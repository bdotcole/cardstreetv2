/**
 * Backfill a long Cache-Control on already-mirrored card images.
 *
 * The mirror originally uploaded objects with no cacheControl, so Supabase
 * stamped them (and the render endpoint that serves them) with the default
 * max-age=3600. Card art is immutable, so a 1-hour edge TTL just makes
 * thumbnails age out of the Cloudflare cache and re-transform constantly — the
 * storage-CDN analog of next.config's minimumCacheTTL. The mirror upload is now
 * fixed for new objects (cacheControl: 31536000); this script re-stamps the
 * objects already in the bucket.
 *
 * Supabase has no metadata-only update, so we download each object's bytes and
 * re-upload them with the long cacheControl (same bytes — content is unchanged).
 *
 *   node scripts/backfill-image-cache-control.mjs [--game=pokemon] [--all]
 *        [--limit=0] [--concurrency=12] [--minAge=86400] [--dry]
 *
 *   --all      also re-stamp large.webp (detail view). Default: small.webp only.
 *   --minAge   skip objects already serving max-age >= this many seconds.
 *
 * Idempotent  — HEADs each object first and skips ones already cached long.
 * Resumable   — paginates by id cursor; safe to ctrl-c and re-run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
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
const GAME = args.game ?? null;
const INCLUDE_LARGE = !!args.all;
const LIMIT = parseInt(args.limit ?? '0', 10) || Infinity;
const CONCURRENCY = parseInt(args.concurrency ?? '12', 10);
const MIN_AGE = parseInt(args.minAge ?? '86400', 10);
const DRY = !!args.dry;
const PAGE_SIZE = 1000;
const BUCKET = 'card-images';
const LONG_TTL = '31536000';
const PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

const stats = { scanned: 0, restamped: 0, skipped: 0, errors: 0 };

// Pull the in-bucket object path out of a public storage URL, or null if the
// URL isn't a card-images object.
function objectPath(url) {
  if (!url || !url.startsWith(PREFIX)) return null;
  return url.slice(PREFIX.length).split('?')[0];
}

async function currentMaxAge(objPath) {
  try {
    const res = await fetch(`${PREFIX}${objPath}`, { method: 'HEAD' });
    const cc = res.headers.get('cache-control') || '';
    const m = cc.match(/max-age=(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

async function restamp(objPath) {
  if ((await currentMaxAge(objPath)) >= MIN_AGE) { stats.skipped++; return; }
  if (DRY) { stats.restamped++; return; }
  try {
    const get = await fetch(`${PREFIX}${objPath}`);
    if (!get.ok) { stats.errors++; return; }
    const buf = Buffer.from(await get.arrayBuffer());
    const contentType = get.headers.get('content-type') || 'image/webp';
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objPath, buf, { contentType, upsert: true, cacheControl: LONG_TTL });
    if (error) { stats.errors++; return; }
    stats.restamped++;
  } catch {
    stats.errors++;
  }
}

async function runPool(items, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

async function main() {
  console.log(`Backfilling Cache-Control=${LONG_TTL} on ${BUCKET} objects`);
  console.log(`Game: ${GAME || 'all'} | variants: ${INCLUDE_LARGE ? 'small+large' : 'small'} | skip >= ${MIN_AGE}s | ${DRY ? 'DRY RUN' : 'live'}\n`);

  let cursor = '';
  let processedRows = 0;
  while (processedRows < LIMIT) {
    let q = supabase
      .from('pokemon_cards')
      .select('id, image_small, image_large')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (GAME) q = q.eq('game', GAME);
    const { data: rows, error } = await q;
    if (error) { console.error('query failed:', error.message); break; }
    if (!rows?.length) break;
    cursor = rows[rows.length - 1].id;

    const paths = [];
    for (const r of rows) {
      const s = objectPath(r.image_small);
      if (s) paths.push(s);
      if (INCLUDE_LARGE) {
        const l = objectPath(r.image_large);
        if (l) paths.push(l);
      }
    }
    stats.scanned += paths.length;
    await runPool(paths, restamp);
    processedRows += rows.length;
    process.stdout.write(`  rows=${processedRows} scanned=${stats.scanned} restamped=${stats.restamped} skipped=${stats.skipped} errors=${stats.errors}\r`);
  }

  console.log(`\n\nDone. scanned=${stats.scanned} restamped=${stats.restamped} skipped=${stats.skipped} errors=${stats.errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
