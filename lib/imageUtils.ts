/**
 * Utility functions for generating optimized image URLs.
 *
 * For Supabase storage URLs we use the built-in render endpoint.
 * For TCGdex we pick a quality segment (low/high/.webp).
 * For pokemontcg.io we toggle the _hires suffix.
 */

const PLACEHOLDER = 'https://images.pokemontcg.io/placeholder.png';

/**
 * A tiny (278B) card-aspect gradient in the brand-dark palette, used as the
 * next/image `blurDataURL`. It paints instantly while the real thumbnail loads,
 * so a new user browsing never-before-cached cards sees a clean skeleton rather
 * than empty boxes during the (~1s) first-view Vercel optimizer transform.
 * Shared across every card grid so the skeleton reads consistently.
 */
export const CARD_BLUR_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAQCAYAAAAiYZ4HAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAyElEQVR4nI2RSQ7DIAxFfYOSgBlDhs5V73++X5l0WlSNFxaSed9+AuJyAJc9XF7g0gwrFSf0YUQXKjo/wHCB4YydSyAJuLwG3nAc0b9g/4HlJP4Dd284t5JN9FH5gn+oGC6tRxpvw7n15J403kb0QkUfJ5DGu/O1TbdxBmm8+yfs0gLSeNs4waalPT9pvG2aGyx/Rhpvl/bgfIAvpzWw5b3CR/jhDNJ4c4NPCPUigW3vFxzHK0jjHYYzYr0ijTcJbHuv029I0x0PIsj0tViPg44AAAAASUVORK5CYII=';

function downsizeTcgdex(url: string, quality: 'low' | 'high'): string {
    // tcgdex assets follow `/<set>/<id>` and optionally `/<quality>.<ext>`
    const stripped = url.replace(/\/(low|high)(\.(png|jpg|jpeg|webp))?$/i, '')
                        .replace(/\.(png|jpg|jpeg|webp)$/i, '');
    return `${stripped}/${quality}.webp`;
}

function downsizePokemonTcg(url: string, quality: 'low' | 'high'): string {
    // pokemontcg.io: `foo.png` is small, `foo_hires.png` is large
    if (quality === 'low') {
        return url.replace(/_hires(\.(png|jpg|jpeg|webp))/i, '$1');
    }
    return url;
}

/**
 * Returns an optimized URL for the given image.
 *
 * @param url The original image URL
 * @param width Target width (used for Supabase render endpoint)
 * @param quality Image quality 1-100 (used for Supabase render endpoint)
 */
export function getOptimizedImageUrl(url: string | null | undefined, width: number = 240, quality: number = 80): string {
    if (!url || typeof url !== 'string' || !url.trim()) return PLACEHOLDER;
    url = url.trim();
    try {
        new URL(url);
    } catch {
        if (!url.startsWith('/')) return PLACEHOLDER;
    }

    // Catalog art mirrored into our own `card-images` bucket is already stored
    // as pre-sized WebP variants (small + large), so serve the object directly.
    // Routing it through the render endpoint would re-encode an already-sized
    // image AND incur Supabase image-transformation billing per origin image —
    // at full-catalog scale (~73k cards) that is a large recurring cost for no
    // gain. Other buckets (seller photos, set logos) keep the render path.
    if (url.includes('/card-images/')) {
        return url;
    }

    if (url.includes('.supabase.co/storage/v1/object/public/')) {
        // resize=contain is required: with width only, the default (cover) keeps
        // the original height and center-crops the width to a sliver.
        return url.replace(
            '/storage/v1/object/public/',
            '/storage/v1/render/image/public/'
        ) + `?width=${width}&quality=${quality}&resize=contain`;
    }

    const wantsSmall = width <= 240;
    if (url.includes('tcgdex.net')) {
        return downsizeTcgdex(url, wantsSmall ? 'low' : 'high');
    }
    if (url.includes('pokemontcg.io')) {
        return downsizePokemonTcg(url, wantsSmall ? 'low' : 'high');
    }

    return url;
}

/**
 * Gets a small thumbnail URL suitable for lists
 */
export function getThumbnailUrl(url: string | null | undefined): string {
    return getOptimizedImageUrl(url, 120, 75);
}

/**
 * Returns a fast URL for a set logo.
 *
 * Set logos live in their own `set-logos` bucket (NOT card-images, which
 * getOptimizedImageUrl deliberately serves direct to avoid render-endpoint
 * billing at 73k-card scale). Logos are few and want per-display downsizing,
 * so they keep the render path. We can't reuse getOptimizedImageUrl here: it
 * would rewrite a tcgdex `.../logo` into a broken `.../logo/low.webp`. This
 * only rewrites our own Supabase-mirrored logos to the CDN render endpoint;
 * every other host is returned unchanged so the caller can let the Vercel
 * optimizer transcode it (e.g. a 200-480KB asia.pokemon-card.com PNG -> ~5KB).
 *
 * Pair the result with shouldSkipNextOptimization(): true for the Supabase
 * render endpoint (already CDN-sized), false otherwise (optimizer transcodes).
 */
export function getSetLogoUrl(url: string | null | undefined, width: number = 240, quality: number = 80): string {
    if (!url || typeof url !== 'string' || !url.trim()) return '';
    url = url.trim();
    if (url.includes('.supabase.co/storage/v1/object/public/')) {
        return url.replace(
            '/storage/v1/object/public/',
            '/storage/v1/render/image/public/'
        ) + `?width=${width}&quality=${quality}&resize=contain`;
    }
    return url;
}

/**
 * Whether to skip Next.js image optimization for a given URL.
 *
 * Pass the URL you are about to render (i.e. AFTER getThumbnailUrl /
 * getPreviewUrl), not the raw DB value — the transforms are what make a URL
 * pre-sized.
 *
 * - TCGdex with /low.webp: already a tiny pre-sized webp (~13KB) — the optimizer
 *   round-trip just adds latency.
 * - Supabase render endpoint: already resized + encoded by Supabase's CDN.
 *   Measured from TH: ~0.18s warm direct vs ~0.6s re-proxied through the
 *   optimizer (and ~1.2s cold), for a ~1KB byte saving. Strictly worse.
 * - Other URLs (pokemontcg.io, asia.pokemon-card.com): full-size PNGs that
 *   benefit enormously from Vercel's transcode + edge cache (asia:
 *   480KB PNG -> 27KB webp).
 */
export function shouldSkipNextOptimization(url: string | null | undefined): boolean {
    if (!url) return false;
    if (url.includes('assets.tcgdex.net') && /\/(low|high)\.webp(\?|$)/.test(url)) return true;
    if (url.includes('.supabase.co/storage/v1/render/image/')) return true;
    // Mirrored catalog art: already pre-sized WebP served straight from the
    // Supabase CDN; re-proxying through Vercel's optimizer only adds latency.
    if (url.includes('/card-images/')) return true;
    return false;
}

/**
 * Gets a medium preview URL suitable for grids
 */
export function getPreviewUrl(url: string | null | undefined): string {
    return getOptimizedImageUrl(url, 300, 80);
}
