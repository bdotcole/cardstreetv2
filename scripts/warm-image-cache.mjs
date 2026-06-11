/**
 * Pre-warm Vercel's image-optimization cache for marketplace listing thumbnails.
 *
 * Why: the first request for each (image, width, format) tuple pays a cold
 * transform (~1-2s TTFB measured from TH); subsequent requests are edge-cached
 * for minimumCacheTTL (31 days). Running this after a deploy that changes image
 * URLs/params (or on a schedule for fresh listings) means real users never see
 * the cold hit on the marketplace grid.
 *
 * Usage: node scripts/warm-image-cache.mjs [--base https://cardstreet.app]
 */

const BASE = process.argv.includes('--base')
    ? process.argv[process.argv.indexOf('--base') + 1]
    : 'https://cardstreet.app';

// Widths Next.js actually requests for the 80px marketplace tiles and other
// thumbnail sites across DPR 1.5/2/3 (imageSizes ladder: ...96,128,256,384).
const WIDTHS = [128, 256, 384];
const QUALITY = 75;
const CONCURRENCY = 8;

// Mirror of lib/imageUtils.ts getThumbnailUrl for the origins listings carry.
// Kept inline because scripts run without the TS build.
function thumbnailUrl(url) {
    if (!url) return null;
    if (url.includes('.supabase.co/storage/v1/object/public/')) {
        return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
            + `?width=120&quality=${QUALITY}&resize=contain`;
    }
    if (url.includes('tcgdex.net')) {
        const stripped = url.replace(/\/(low|high)(\.(png|jpg|jpeg|webp))?$/i, '')
            .replace(/\.(png|jpg|jpeg|webp)$/i, '');
        return `${stripped}/low.webp`;
    }
    if (url.includes('pokemontcg.io')) {
        return url.replace(/_hires(\.(png|jpg|jpeg|webp))/i, '$1');
    }
    return url;
}

// Mirror of shouldSkipNextOptimization: these are rendered unoptimized, so
// there is no Vercel variant to warm. Supabase render URLs still benefit from
// a direct warm-up (Supabase's own transform cache).
function isDirect(url) {
    return /assets\.tcgdex\.net.*\/(low|high)\.webp$/.test(url)
        || url.includes('.supabase.co/storage/v1/render/image/');
}

async function fetchListings() {
    const urls = new Set();
    for (let offset = 0; ; offset += 100) {
        const res = await fetch(`${BASE}/api/listings?limit=100&offset=${offset}`);
        if (!res.ok) break;
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) break;
        for (const l of items) {
            const src = l.card_data?.images?.small || l.card_data?.imageUrl;
            if (src) urls.add(src);
        }
        if (items.length < 100) break;
    }
    return [...urls];
}

async function warm(targets) {
    let done = 0, slow = 0, failed = 0;
    const queue = [...targets];
    async function worker() {
        while (queue.length) {
            const target = queue.pop();
            const t0 = Date.now();
            try {
                const res = await fetch(target, {
                    headers: { Accept: 'image/avif,image/webp,image/png,*/*' },
                });
                const ms = Date.now() - t0;
                if (!res.ok) { failed++; console.log(`  FAIL ${res.status} ${target}`); }
                else { done++; if (ms > 1000) slow++; }
                await res.arrayBuffer();
            } catch (e) {
                failed++;
                console.log(`  ERROR ${e.message} ${target}`);
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { done, slow, failed };
}

const sources = await fetchListings();
console.log(`${sources.length} unique listing images`);

const targets = [];
for (const src of sources) {
    const thumb = thumbnailUrl(src);
    if (!thumb) continue;
    if (thumb.includes('.supabase.co/storage/v1/render/image/')) {
        targets.push(thumb);
    } else if (!isDirect(thumb)) {
        for (const w of WIDTHS) {
            targets.push(`${BASE}/_next/image?url=${encodeURIComponent(thumb)}&w=${w}&q=${QUALITY}`);
        }
    }
}
console.log(`warming ${targets.length} optimizer variants...`);

const t0 = Date.now();
const { done, slow, failed } = await warm(targets);
console.log(`done: ${done} ok (${slow} were cold >1s), ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
