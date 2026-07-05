/**
 * Monthly Vercel cron: self-host any catalog card images still hotlinked from
 * third-party hosts (a new set ingested since the last run leaves its art on
 * TCGdex / Scryfall / ygoprodeck / etc.). Keeps the catalog independent of
 * upstream availability over time — the bulk one-time backfill lives in
 * scripts/ingest/mirror-card-images.mjs and this is the incremental counterpart.
 *
 * Also mirrors sealed-product packshots (new rows from the weekly PriceCharting
 * ingest) with their white studio background stripped — see
 * lib/sealedImageMirror.ts; bulk counterpart scripts/ingest/mirror-sealed-images.ts.
 *
 * Runs on the nodejs runtime because `sharp` is a native module (same reason
 * /api/scan does). Bounded by a wall-clock budget so it can never time out;
 * any overflow is picked up on the next run (the work is idempotent).
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';
import { processSealedImage, isMirroredSealedUrl, SEALED_MIRROR_PREFIX } from '@/lib/sealedImageMirror';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BUCKET = 'card-images';
const SMALL_W = 245, SMALL_Q = 78;
const LARGE_W = 734, LARGE_Q = 82;
const CONCURRENCY = 5;
const TIME_BUDGET_MS = 240_000; // stop well before the 300s function ceiling
const MAX_ROWS = 4000;          // hard cap regardless of budget

function sourceUrl(row: { image_small: string | null; image_large: string | null }): string | null {
  let u = row.image_large || row.image_small;
  if (!u) return null;
  // TCGdex stores extension-less base URLs; the asset host serves .webp there.
  if (u.includes('tcgdex.net') && !/\.(png|jpg|jpeg|webp)$/i.test(u)) u += '.webp';
  return u;
}

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const started = Date.now();
  const counts = { ok: 0, fail: 0 };
  let processed = 0;
  let lastId = '';

  async function processRow(row: { id: string; image_small: string | null; image_large: string | null }) {
    const src = sourceUrl(row);
    if (!src) return; // corrupt/empty source — skip, surfaced by the bulk script
    try {
      const res = await fetch(src, { headers: { 'User-Agent': 'cardstreet-image-mirror/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const original = Buffer.from(await res.arrayBuffer());
      const [largeBuf, smallBuf] = await Promise.all([
        sharp(original).resize({ width: LARGE_W, withoutEnlargement: true }).webp({ quality: LARGE_Q }).toBuffer(),
        sharp(original).resize({ width: SMALL_W, withoutEnlargement: true }).webp({ quality: SMALL_Q }).toBuffer(),
      ]);
      const up = async (path: string, buf: Buffer) => {
        const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'image/webp', upsert: true });
        if (error) throw new Error(error.message);
        return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
      };
      const largeUrl = await up(`${row.id}/large.webp`, largeBuf);
      const smallUrl = await up(`${row.id}/small.webp`, smallBuf);
      const { error } = await supabase.from('pokemon_cards').update({ image_small: smallUrl, image_large: largeUrl }).eq('id', row.id);
      if (error) throw new Error(error.message);
      counts.ok++;
    } catch {
      counts.fail++;
    }
  }

  // Mirror loop: page by id cursor, only rows still on a third-party host.
  outer: while (processed < MAX_ROWS && Date.now() - started < TIME_BUDGET_MS) {
    let q = supabase
      .from('pokemon_cards')
      .select('id, image_small, image_large')
      .not('image_small', 'is', null)
      .not('image_small', 'ilike', '%supabase.co%')
      .order('id', { ascending: true })
      .limit(200);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) break;
    if (!data || data.length === 0) break;

    for (let i = 0; i < data.length; i += CONCURRENCY) {
      if (Date.now() - started >= TIME_BUDGET_MS) break outer;
      await Promise.all(data.slice(i, i + CONCURRENCY).map(processRow));
      processed += Math.min(CONCURRENCY, data.length - i);
    }
    lastId = data[data.length - 1].id;
    if (data.length < 200) break;
  }

  // Sealed products: the weekly PriceCharting ingest adds rows with hotlinked
  // white-background packshots. Mirror them into card-images/sealed/<id>.webp
  // with the background stripped (lib/sealedImageMirror) and repoint image_url.
  // Shares the wall-clock budget; the bulk backfill ran 2026-07-05, so this is
  // normally a handful of rows per month. Rows whose upstream image is dead
  // fail here and are retried next run (harmless — they keep their old URL).
  const sealedCounts = { ok: 0, fail: 0 };
  try {
    let sealedCursor = '';
    sealedOuter: while (Date.now() - started < TIME_BUDGET_MS) {
      let q = supabase
        .from('sealed_products')
        .select('id, image_url')
        .not('image_url', 'is', null)
        .not('image_url', 'ilike', `%/card-images/${SEALED_MIRROR_PREFIX}/%`)
        .order('id', { ascending: true })
        .limit(200);
      if (sealedCursor) q = q.gt('id', sealedCursor);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;

      const mirrorSealed = async (row: { id: string; image_url: string }) => {
        try {
          const result = await processSealedImage(row.image_url);
          if (!result) return; // entirely-background placeholder — leave as is
          const path = `${SEALED_MIRROR_PREFIX}/${row.id}.webp`;
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, result.buffer, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
          if (upErr) throw new Error(upErr.message);
          const newUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
          const { error: dbErr } = await supabase.from('sealed_products').update({ image_url: newUrl }).eq('id', row.id);
          if (dbErr) throw new Error(dbErr.message);
          sealedCounts.ok++;
        } catch {
          sealedCounts.fail++;
        }
      };

      for (let i = 0; i < data.length; i += CONCURRENCY) {
        if (Date.now() - started >= TIME_BUDGET_MS) break sealedOuter;
        await Promise.all(data.slice(i, i + CONCURRENCY).map(mirrorSealed));
      }
      sealedCursor = data[data.length - 1].id;
      if (data.length < 200) break;
    }
  } catch {
    // non-fatal — card mirroring is the primary job
  }

  // Sync active-listing snapshots whose card was mirrored but whose card_data
  // still points at a third-party host (a listing created before the mirror).
  // Sealed listings resolve against sealed_products instead of pokemon_cards.
  let listingsUpdated = 0;
  try {
    const { data: listings } = await supabase
      .from('listings')
      .select('id, card_id, card_data')
      .eq('status', 'active');
    for (const l of listings || []) {
      const cd: any = l.card_data || {};
      if (cd.images?.small?.includes('/card-images/')) continue;

      let smallUrl: string | null = null;
      let largeUrl: string | null = null;
      if (cd.isSealed) {
        const { data: product } = await supabase
          .from('sealed_products')
          .select('image_url')
          .eq('id', l.card_id)
          .maybeSingle();
        if (!isMirroredSealedUrl(product?.image_url)) continue;
        smallUrl = largeUrl = product!.image_url;
      } else {
        const { data: card } = await supabase
          .from('pokemon_cards')
          .select('image_small, image_large')
          .eq('id', l.card_id)
          .maybeSingle();
        if (!card?.image_small?.includes('/card-images/')) continue;
        smallUrl = card.image_small;
        largeUrl = card.image_large;
      }

      const next = { ...cd, imageUrl: largeUrl, images: { ...(cd.images || {}), small: smallUrl, large: largeUrl } };
      const { error } = await supabase.from('listings').update({ card_data: next }).eq('id', l.id);
      if (!error) listingsUpdated++;
    }
  } catch {
    // non-fatal — catalog mirroring is the primary job
  }

  return NextResponse.json({
    success: true,
    mirrored: counts.ok,
    failed: counts.fail,
    sealedMirrored: sealedCounts.ok,
    sealedFailed: sealedCounts.fail,
    listingsUpdated,
    elapsedMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  });
}
