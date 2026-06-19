import { BASE_URL } from '@/lib/i18nRouting';
import { sitemapPageCount } from '@/lib/cardSitemap';

// Sitemap index for the ~76k card detail pages. Split into numbered child
// sitemaps (/cards-sitemap/0, /cards-sitemap/1, ...) because one file can't hold
// them all. Referenced from robots.ts. Cached a day — the card set changes slowly.
export const revalidate = 86400;

export async function GET() {
    const pages = await sitemapPageCount();
    const now = new Date().toISOString();
    const entries = Array.from({ length: pages }, (_, i) =>
        `<sitemap><loc>${BASE_URL}/cards-sitemap/${i}</loc><lastmod>${now}</lastmod></sitemap>`
    ).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
    return new Response(xml, {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' },
    });
}
