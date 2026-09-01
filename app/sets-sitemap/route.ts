import { sitemapUrlEntries } from '@/lib/i18nRouting';
import { getAllSetIds } from '@/lib/setPageData';

// All ~947 set landing pages in one file (well under the 1000-row query cap and
// the 50k-URL sitemap cap), each with th/en hreflang. Listed in robots.ts.
export const revalidate = 86400;

export async function GET() {
    const ids = await getAllSetIds();
    const urls = ids
        .map((id) => {
            const path = `/sets/${id}`;
            return sitemapUrlEntries(path);
        })
        .join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;
    return new Response(xml, {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' },
    });
}
