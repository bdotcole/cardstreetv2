/**
 * Mirror set logos from third-party hosts (asia.pokemon-card.com, tcgdex,
 * ygoprodeck, ...) into our own Supabase storage, same rationale as
 * mirror-card-images.mjs: serving from the Supabase CDN render endpoint is the
 * measured-fast path (~0.13s warm, CF-cached) and lets us drop the per-host
 * `unoptimized` hacks in the set selectors.
 *
 * The big offender today is the Thai Pokemon logos: heavy ~200-480KB PNGs on
 * asia.pokemon-card.com that the UI forces `unoptimized`, so they bypass both
 * the Vercel optimizer AND the Supabase CDN. After mirroring + render-endpoint
 * resizing a 480px logo serves as a ~5KB webp.
 *
 *   node scripts/ingest/mirror-set-logos.mjs [--game=pokemon] [--language=th]
 *        [--host=asia.pokemon-card.com] [--limit=100] [--force] [--dry]
 *
 * Idempotent  — rows already pointing at supabase.co are skipped (unless --force).
 * Reversible  — every original logo_url is backed up to
 *               scripts/out/set-logo-originals.json before the repoint.
 * SVG logos (svgs.scryfall.io) are skipped: they're already tiny vectors.
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
const GAME = args.game ?? null;
const LANGUAGE = args.language ?? null;
const HOST = args.host ?? null;          // substring filter on the source logo_url
const LIMIT = parseInt(args.limit ?? '0', 10) || Infinity;
const FORCE = !!args.force;
const DRY = !!args.dry;
// Set logos live in their OWN bucket, deliberately NOT card-images: lib/imageUtils
// serves the card-images bucket directly (no render endpoint) to dodge Supabase
// image-transformation billing at 73k-card scale. Set logos are few (~1k) and
// want the render endpoint's per-display downsizing, so they "keep the render
// path" in a separate bucket (matching the comment in getOptimizedImageUrl).
const BUCKET = 'set-logos';

// One generous webp at (≤) the source resolution. The Supabase render endpoint
// downsizes per display (64px thumb in the selector, 96-150px in detail), so a
// single stored object covers every surface. withoutEnlargement keeps it ≤ source.
const MAX_W = 480, QUALITY = 82;

const BACKUP_PATH = path.join(__dirname, '..', 'out', 'set-logo-originals.json');

function loadBackup() {
  try { return JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8')); } catch { return {}; }
}
function saveBackup(obj) {
  fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true });
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(obj, null, 2));
}

async function fetchBuffer(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'cardstreet-set-logo-mirror/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    return { buf: Buffer.from(await res.arrayBuffer()), contentType: ct };
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return fetchBuffer(url, attempt + 1);
    }
    throw e;
  }
}

async function processRow(row, backup) {
  const src = row.logo_url;
  if (!src) return { status: 'skip-no-url' };
  if (/\.svg(\?|$)/i.test(src) || src.includes('svgs.scryfall.io')) return { status: 'skip-svg' };
  try {
    const { buf, contentType } = await fetchBuffer(src);
    if (contentType.includes('svg')) return { status: 'skip-svg' };
    const webp = await sharp(buf)
      .resize({ width: MAX_W, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    if (DRY) return { status: 'ok', bytes: webp.length };

    const objectPath = `${row.id}.webp`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, webp, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;

    // Back up the original before repointing (reversibility).
    if (!(row.id in backup)) { backup[row.id] = src; saveBackup(backup); }

    const { error: dbErr } = await supabase
      .from('pokemon_sets')
      .update({ logo_url: publicUrl })
      .eq('id', row.id).eq('game', row.game).eq('language', row.language);
    if (dbErr) throw new Error(`db: ${dbErr.message}`);
    return { status: 'ok', bytes: webp.length };
  } catch (e) {
    return { status: 'fail', error: e.message };
  }
}

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '2MB',
    allowedMimeTypes: ['image/webp'],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(`created public bucket "${BUCKET}"`);
}

async function main() {
  console.log('set-logo mirror');
  if (!DRY) await ensureBucket();
  console.log(`  filters: game=${GAME ?? '(all)'} language=${LANGUAGE ?? '(all)'} host=${HOST ?? '(any non-supabase)'}`);
  console.log(`  limit=${LIMIT === Infinity ? '(unlimited)' : LIMIT} force=${FORCE} dry=${DRY}`);

  let q = supabase
    .from('pokemon_sets')
    .select('id, game, language, name, logo_url')
    .not('logo_url', 'is', null)
    .order('release_date', { ascending: false, nullsFirst: false });
  if (!FORCE) q = q.not('logo_url', 'ilike', '%supabase.co%');
  if (GAME) q = q.eq('game', GAME);
  if (LANGUAGE) q = q.eq('language', LANGUAGE);
  if (HOST) q = q.ilike('logo_url', `%${HOST}%`);
  const { data: rows, error } = await q;
  if (error) throw error;

  const work = rows.slice(0, LIMIT);
  console.log(`  ${work.length} set logos to mirror\n`);

  const backup = loadBackup();
  const counts = {};
  let bytes = 0;
  for (const row of work) {
    const res = await processRow(row, backup);
    counts[res.status] = (counts[res.status] || 0) + 1;
    bytes += res.bytes || 0;
    const tag = res.status === 'ok' ? 'mirrored' : res.status;
    console.log(`  ${tag.padEnd(11)} ${row.id}  ${res.error ? '— ' + res.error : ''}`);
  }

  console.log(`\nDone. ${JSON.stringify(counts)} | ${(bytes / 1e3).toFixed(0)}KB stored`);
  console.log(`Originals backed up to ${path.relative(process.cwd(), BACKUP_PATH)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
