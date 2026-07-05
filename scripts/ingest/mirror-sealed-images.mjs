/**
 * Mirror sealed-product images into our storage with the white studio
 * background removed, so packshots sit cleanly on the app's dark tiles.
 *
 * For every sealed_products row with an image_url not already under
 * card-images/sealed/:
 *   1. Download the image (TCGplayer / PriceCharting / our sealed-th mirror).
 *   2. Flood-fill the near-white background inward from the borders to alpha,
 *      with a soft ramp so JPEG halos and drop shadows fade out instead of
 *      leaving a fringe. Images that don't sit on a white background (border
 *      not predominantly white) are mirrored unchanged.
 *   3. Trim to the content bounding box (small margin), cap the long edge,
 *      encode WebP with alpha.
 *   4. Upload to card-images/sealed/<product-id>.webp and repoint image_url.
 *
 * Old URLs are written to scripts/ingest/backups/sealed-image-urls-<date>.json
 * before any DB write, so the repoint is reversible. Idempotent: rows already
 * pointing at card-images/sealed/ are skipped; re-run anytime to sweep failures.
 *
 * Usage:
 *   node scripts/ingest/mirror-sealed-images.mjs --dry-run
 *   node scripts/ingest/mirror-sealed-images.mjs [--limit=100] [--language=th] [--concurrency=6]
 *   node scripts/ingest/mirror-sealed-images.mjs --sample=<url> --out=<file>   # local test, no uploads
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local lives in the main tree; when running from a worktree fall back to it.
for (const envPath of [
  path.join(__dirname, '..', '..', '.env.local'),
  'C:/Users/brand/Downloads/cardstreet-tcg/.env.local',
]) {
  if (!fs.existsSync(envPath)) continue;
  fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^["']|["']$/g, '');
  });
  break;
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const BUCKET = 'card-images';
const PREFIX = 'sealed';
const MAX_EDGE = 700;
// Flood fill: a border-connected pixel joins the background only when it is
// nearly pure white — pale product art (icy skies, white logos) must survive,
// so the threshold sits above JPEG-noise white but below "light artwork".
const BG_MIN_CHANNEL = 245;   // min(r,g,b) at least this bright
const BG_NEUTRALITY = 10;     // max channel spread (keeps colored art out)
// Feather: a few dilation rings around the removed region get a brightness-
// scaled alpha ramp, melting JPEG halos and soft drop shadows into the tile.
const FEATHER_RINGS = 3;
const FEATHER_MIN_CHANNEL = 200;

function isBg(data, i) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn >= BG_MIN_CHANNEL && mx - mn <= BG_NEUTRALITY;
}

/**
 * Remove the white background from an RGBA buffer in place.
 * Returns { removedFrac, whiteBorderFrac }.
 */
function stripWhiteBackground(data, width, height) {
  const n = width * height;
  const mask = new Uint8Array(n); // 1 = background
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;

  let whiteBorder = 0, borderCount = 0;
  const seed = (x, y) => {
    const p = y * width + x;
    borderCount++;
    if (isBg(data, p * 4)) {
      whiteBorder++;
      if (!mask[p]) { mask[p] = 1; queue[qt++] = p; }
    }
  };
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }

  const whiteBorderFrac = whiteBorder / Math.max(1, borderCount);
  // Not a white-background packshot — leave it alone. Products cropped at the
  // frame edge can cover most of the border, so the gate is deliberately low;
  // non-white backgrounds measure near 0 against the strict white threshold.
  if (whiteBorderFrac < 0.3) return { removedFrac: 0, whiteBorderFrac };

  while (qh < qt) {
    const p = queue[qh++];
    const x = p % width, y = (p / width) | 0;
    if (x > 0 && !mask[p - 1] && isBg(data, (p - 1) * 4)) { mask[p - 1] = 1; queue[qt++] = p - 1; }
    if (x < width - 1 && !mask[p + 1] && isBg(data, (p + 1) * 4)) { mask[p + 1] = 1; queue[qt++] = p + 1; }
    if (y > 0 && !mask[p - width] && isBg(data, (p - width) * 4)) { mask[p - width] = 1; queue[qt++] = p - width; }
    if (y < height - 1 && !mask[p + width] && isBg(data, (p + width) * 4)) { mask[p + width] = 1; queue[qt++] = p + width; }
  }

  for (let p = 0; p < n; p++) if (mask[p]) data[p * 4 + 3] = 0;

  // Feather: dilate the removed region a few rings; bright pixels in each ring
  // fade by brightness so JPEG halos and drop shadows blend into any tile color
  // instead of leaving a white/gray fringe. Dark product edges are untouched.
  let band = mask;
  for (let ring = 0; ring < FEATHER_RINGS; ring++) {
    const next = new Uint8Array(band); // carries forward already-banded pixels
    const fade = 1 - (ring + 1) / (FEATHER_RINGS + 1); // outer rings fade more
    for (let p = 0; p < n; p++) {
      if (band[p]) continue;
      const x = p % width, y = (p / width) | 0;
      const touches =
        (x > 0 && band[p - 1]) || (x < width - 1 && band[p + 1]) ||
        (y > 0 && band[p - width]) || (y < height - 1 && band[p + width]);
      if (!touches) continue;
      next[p] = 1;
      const i = p * 4;
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      if (mn >= FEATHER_MIN_CHANNEL) {
        const t = (mn - FEATHER_MIN_CHANNEL) / (255 - FEATHER_MIN_CHANNEL); // 0..1, whiter = fainter
        data[i + 3] = Math.min(data[i + 3], Math.round(255 * (1 - t * (1 - fade * 0.4))));
      }
    }
    band = next;
  }

  return { removedFrac: qt / n, whiteBorderFrac };
}

/** Download + strip background + trim + encode webp. Returns { buffer, stripped } or null on skip. */
async function processImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CardStreet mirror)' } });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  const base = sharp(input, { limitInputPixels: 50_000_000 }).rotate();
  const { data, info } = await base.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const { removedFrac, whiteBorderFrac } = stripWhiteBackground(data, width, height);

  // Whole image was background (blank/placeholder) — flag, don't mirror.
  if (removedFrac > 0.98) return null;

  let img = sharp(data, { raw: { width, height, channels: 4 } });

  if (removedFrac > 0) {
    // Trim to the content bounding box with a 2% margin.
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX && maxY > minY) {
      const mx = Math.round((maxX - minX) * 0.02), my = Math.round((maxY - minY) * 0.02);
      const left = Math.max(0, minX - mx), top = Math.max(0, minY - my);
      img = img.extract({
        left,
        top,
        width: Math.min(width, maxX + mx + 1) - left,
        height: Math.min(height, maxY + my + 1) - top,
      });
    }
  }

  const buffer = await img
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  return { buffer, stripped: removedFrac > 0, whiteBorderFrac };
}

// ---- --sample mode: process one URL to a local file, no DB/storage touched ----
if (args.sample) {
  const out = args.out || 'sample-out.webp';
  const result = await processImage(args.sample);
  if (!result) {
    console.log('SKIP: image is entirely background');
  } else {
    fs.writeFileSync(out, result.buffer);
    console.log(`wrote ${out} (${result.buffer.length} bytes, stripped=${result.stripped}, whiteBorder=${result.whiteBorderFrac.toFixed(2)})`);
  }
  process.exit(0);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DRY = !!args['dry-run'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const CONCURRENCY = args.concurrency ? parseInt(args.concurrency, 10) : 6;

// Collect candidate rows (id-cursor pagination, same pattern as backfill-phashes).
const rows = [];
let cursor = null;
for (;;) {
  let q = supabase
    .from('sealed_products')
    .select('id, language, game, image_url')
    .not('image_url', 'is', null)
    .order('id')
    .limit(1000);
  if (args.language) q = q.eq('language', args.language);
  if (cursor) q = q.gt('id', cursor);
  const { data, error } = await q;
  if (error) { console.error('select failed:', error.message); process.exit(1); }
  for (const r of data) {
    if (!r.image_url.includes(`/${BUCKET}/${PREFIX}/`)) rows.push(r);
  }
  if (data.length < 1000) break;
  cursor = data[data.length - 1].id;
}

const todo = rows.slice(0, LIMIT);
console.log(`${rows.length} rows need mirroring; processing ${todo.length}${DRY ? ' (dry run)' : ''}`);

// Backup of old URLs, written before any DB update.
const backupDir = path.join(__dirname, 'backups');
if (!DRY && todo.length > 0) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(backupDir, `sealed-image-urls-${stamp}.json`);
  const existing = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, 'utf-8')) : {};
  for (const r of todo) existing[r.id] ??= r.image_url;
  fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2));
  console.log(`old URLs backed up to ${backupPath}`);
}

let ok = 0, skipped = 0, failed = 0, unstripped = 0;
let idx = 0;
async function worker() {
  for (;;) {
    const i = idx++;
    if (i >= todo.length) return;
    const row = todo[i];
    try {
      const result = await processImage(row.image_url);
      if (!result) {
        skipped++;
        console.log(`SKIP ${row.id}: entirely background`);
        continue;
      }
      if (!result.stripped) unstripped++;
      if (DRY) { ok++; continue; }

      const objectPath = `${PREFIX}/${row.id}.webp`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, result.buffer, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: true,
        });
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      const newUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
      const { error: dbErr } = await supabase
        .from('sealed_products')
        .update({ image_url: newUrl })
        .eq('id', row.id);
      if (dbErr) throw new Error(`update: ${dbErr.message}`);

      ok++;
      if (ok % 50 === 0) console.log(`...${ok}/${todo.length}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${row.id}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`done: ${ok} mirrored (${unstripped} without white bg to strip), ${skipped} skipped, ${failed} failed`);
