import { BASE_URL } from '@/lib/i18nRouting';
import { sitemapPageCount } from '@/lib/cardSitemap';

// Sitemap index for the ~100k card detail pages. Split into numbered child
// sitemaps (/cards-sitemap/0, /cards-sitemap/1, ...) because one file can't hold
// them all. Referenced from robots.ts. Cached a day — the card set changes slowly.
//
// NO <lastmod> HERE, AND THAT IS DELIBERATE. This used to stamp every entry with
// `new Date()` — "all 100+ child sitemaps changed just now", on every fetch.
// That is not a weak signal, it is a false one, and Google's documented
// behaviour is to ignore a site's lastmod values entirely once it judges them
// unreliable, which would also discard the real per-URL dates the child
// sitemaps now carry. An honest per-chunk max would mean running every chunk's
// query on this one request (100+ x ~1s), so the child files are where the
// signal lives. Removed 2026-08-14.
export const revalidate = 86400;

export async function GET() {
    const pages = await sitemapPageCount();
    const entries = Array.from({ length: pages }, (_, i) =>
        `<sitemap><loc>${BASE_URL}/cards-sitemap/${i}</loc></sitemap>`
    ).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
    return new Response(xml, {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' },
    });
}
