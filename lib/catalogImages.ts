/**
 * Server-only helper for getting catalog card art into our own storage.
 *
 * Mirrors the geometry and bucket layout of scripts/ingest/mirror-card-images.mjs
 * so admin-created cards are indistinguishable from script-ingested ones: two
 * pre-sized WebP variants (small for grids, large for detail) under
 * `card-images/{id}/{small,large}.webp` in a public bucket.
 *
 * Re-encoding an uploaded file OR a pasted URL through here (rather than storing
 * a raw external URL) is what guarantees the grid always loads a genuinely small
 * thumbnail — the single biggest catalog-load perf lever (see CLAUDE.md).
 *
 * `sharp` is a native module, so any route importing this MUST run on the
 * nodejs runtime (`export const runtime = 'nodejs'`), never Edge.
 */

import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'card-images';

// Variant geometry — identical to the mirror script so re-running the mirror
// later produces byte-equivalent output and nothing churns.
const SMALL_W = 245;
const SMALL_Q = 78;
const LARGE_W = 734;
const LARGE_Q = 82;

export type CardImageSource = File | { url: string };

export interface CardImageUrls {
    smallUrl: string;
    largeUrl: string;
}

/** TCGdex stores extension-less base URLs ("/151/high"); the host serves .webp there. */
function normalizeSourceUrl(url: string): string {
    if (url.includes('tcgdex.net') && !/\.(png|jpg|jpeg|webp)$/i.test(url)) {
        return `${url}.webp`;
    }
    return url;
}

async function readSourceBytes(source: CardImageSource): Promise<Buffer> {
    if (source instanceof File) {
        return Buffer.from(await source.arrayBuffer());
    }
    const res = await fetch(normalizeSourceUrl(source.url), {
        headers: { 'User-Agent': 'cardstreet-admin-catalog/1.0' },
    });
    if (!res.ok) {
        throw new Error(`Could not fetch image URL (HTTP ${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Ensure the public card-images bucket exists. Idempotent; safe to call on every
 * upload. Service-role only.
 */
export async function ensureCardImageBucket(): Promise<void> {
    const supabase = createAdminClient();
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await supabase.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: '5MB',
        allowedMimeTypes: ['image/webp'],
    });
    if (error && !/already exists/i.test(error.message)) throw error;
}

async function uploadWebp(objectPath: string, buf: Buffer): Promise<string> {
    const supabase = createAdminClient();
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, buf, { contentType: 'image/webp', upsert: true });
    if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
    return supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

/**
 * Re-encode the given image (uploaded file or remote URL) into small+large WebP
 * variants and upload both to `card-images/{id}/`. Returns the public URLs to
 * store in pokemon_cards.image_small / image_large.
 */
export async function processAndUploadCardImage(args: {
    source: CardImageSource;
    id: string;
}): Promise<CardImageUrls> {
    const { source, id } = args;
    await ensureCardImageBucket();

    const original = await readSourceBytes(source);

    // withoutEnlargement: never upscale a source smaller than our target width.
    const [largeBuf, smallBuf] = await Promise.all([
        sharp(original).resize({ width: LARGE_W, withoutEnlargement: true }).webp({ quality: LARGE_Q }).toBuffer(),
        sharp(original).resize({ width: SMALL_W, withoutEnlargement: true }).webp({ quality: SMALL_Q }).toBuffer(),
    ]);

    const largeUrl = await uploadWebp(`${id}/large.webp`, largeBuf);
    const smallUrl = await uploadWebp(`${id}/small.webp`, smallBuf);
    return { smallUrl, largeUrl };
}

/** Remove a card's mirrored image objects (best-effort; used on card delete). */
export async function deleteCardImage(id: string): Promise<void> {
    const supabase = createAdminClient();
    await supabase.storage.from(BUCKET).remove([`${id}/large.webp`, `${id}/small.webp`]);
}
