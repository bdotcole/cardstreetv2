/**
 * Bulk mirror of sealed-product images into our storage with the white studio
 * background removed (algorithm in lib/sealedImageMirror.ts — shared with the
 * monthly /api/cron/mirror-images run, which handles new rows incrementally).
 *
 * For every sealed_products row with an image_url not already under
 * card-images/sealed/: download, strip background, upload to
 * card-images/sealed/<product-id>.webp, repoint image_url.
 *
 * Old URLs are written to scripts/ingest/backups/sealed-image-urls-<date>.json
 * before any DB write, so the repoint is reversible. Idempotent — re-run
 * anytime to sweep failures (dead upstreams keep their old URL).
 *
 * First bulk run 2026-07-05: 2919 mirrored, 26 failed (upstream 404/500).
 *
 * Usage:
 *   npx tsx scripts/ingest/mirror-sealed-images.ts --dry-run
 *   npx tsx scripts/ingest/mirror-sealed-images.ts [--limit=100] [--language=th] [--concurrency=6]
 *   npx tsx scripts/ingest/mirror-sealed-images.ts --sample=<url> --out=<file>   # local test, no uploads
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { processSealedImage, SEALED_MIRROR_PREFIX } from '../../lib/sealedImageMirror';

// Worktree-friendly: fall back to the main tree's .env.local.
dotenv.config({ path: '.env.local' });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/brand/Downloads/cardstreet-tcg/.env.local' });
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
) as Record<string, string | true>;

const BUCKET = 'card-images';

async function main() {
  // --sample mode: process one URL to a local file, no DB/storage touched.
  if (typeof args.sample === 'string') {
    const out = typeof args.out === 'string' ? args.out : 'sample-out.webp';
    const result = await processSealedImage(args.sample);
    if (!result) {
      console.log('SKIP: image is entirely background');
      return;
    }
    fs.writeFileSync(out, result.buffer);
    console.log(`wrote ${out} (${result.buffer.length} bytes, stripped=${result.stripped}, whiteBorder=${result.whiteBorderFrac.toFixed(2)})`);
    return;
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const DRY = !!args['dry-run'];
  const LIMIT = typeof args.limit === 'string' ? parseInt(args.limit, 10) : Infinity;
  const CONCURRENCY = typeof args.concurrency === 'string' ? parseInt(args.concurrency, 10) : 6;

  // Collect candidate rows (id-cursor pagination, same pattern as backfill-phashes).
  const rows: { id: string; image_url: string }[] = [];
  let cursor: string | null = null;
  for (;;) {
    let q = supabase
      .from('sealed_products')
      .select('id, language, game, image_url')
      .not('image_url', 'is', null)
      .order('id')
      .limit(1000);
    if (typeof args.language === 'string') q = q.eq('language', args.language);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) { console.error('select failed:', error.message); process.exit(1); }
    for (const r of data!) {
      if (!r.image_url.includes(`/${BUCKET}/${SEALED_MIRROR_PREFIX}/`)) rows.push(r);
    }
    if (!data || data.length < 1000) break;
    cursor = data[data.length - 1].id;
  }

  const todo = rows.slice(0, LIMIT);
  console.log(`${rows.length} rows need mirroring; processing ${todo.length}${DRY ? ' (dry run)' : ''}`);

  // Backup of old URLs, written before any DB update.
  if (!DRY && todo.length > 0) {
    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `sealed-image-urls-${new Date().toISOString().slice(0, 10)}.json`);
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
        const result = await processSealedImage(row.image_url);
        if (!result) {
          skipped++;
          console.log(`SKIP ${row.id}: entirely background`);
          continue;
        }
        if (!result.stripped) unstripped++;
        if (DRY) { ok++; continue; }

        const objectPath = `${SEALED_MIRROR_PREFIX}/${row.id}.webp`;
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
      } catch (err: any) {
        failed++;
        console.log(`FAIL ${row.id}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`done: ${ok} mirrored (${unstripped} without white bg to strip), ${skipped} skipped, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
