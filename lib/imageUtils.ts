/**
 * Utility functions for generating optimized image URLs.
 *
 * For Supabase storage URLs we use the built-in render endpoint.
 * For TCGdex we pick a quality segment (low/high/.webp).
 * For pokemontcg.io we toggle the _hires suffix.
 */

const PLACEHOLDER = 'https://images.pokemontcg.io/placeholder.png';

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

    if (url.includes('.supabase.co/storage/v1/object/public/')) {
        return url.replace(
            '/storage/v1/object/public/',
            '/storage/v1/render/image/public/'
        ) + `?width=${width}&quality=${quality}`;
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
 * Whether to skip Next.js image optimization for a given URL.
 *
 * - TCGdex with /low.webp: already a tiny pre-sized webp (~13KB) — the optimizer
 *   round-trip just adds latency.
 * - Other URLs (pokemontcg.io, asia.pokemon-card.com): full-size PNGs that
 *   benefit enormously from Vercel's transcode + edge cache.
 */
export function shouldSkipNextOptimization(url: string | null | undefined): boolean {
    if (!url) return false;
    if (url.includes('assets.tcgdex.net') && /\/(low|high)\.webp(\?|$)/.test(url)) return true;
    return false;
}

/**
 * Gets a medium preview URL suitable for grids
 */
export function getPreviewUrl(url: string | null | undefined): string {
    return getOptimizedImageUrl(url, 300, 80);
}
