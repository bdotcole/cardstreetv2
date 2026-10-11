import { localizedUrl } from '@/lib/i18nRouting';
import { cardsForPage } from '@/lib/cardSitemap';

// One child sitemap: up to CARDS_PER_SITEMAP card URLs, each advertising its
// Thai (canonical/bare) and English (/en) variants via hreflang. Card ids are
// ascii [A-Za-z0-9-] so they need no XML/URL escaping.
//
// Each URL carries a real <lastmod> — the later of the catalog row's updated_at
// and its newest market price — so a crawler working through 100k+ URLs can see
// which ones actually changed. A card with no honest date gets no lastmod
// element; see lastmodFor in lib/cardSitemap.ts for why that beats guessing.
export const revalidate = 86400;

export async function GET(_req: Request, { params }: { params: Promise<{ page: string }> }) {
    const { page } = await params;
    const n = Number.parseInt(page, 10);
    if (Number.isNaN(n) || n < 0) {
        return new Response('Not found', { status: 404 });
    }

    const cards = await cardsForPage(n);
    if (cards.length === 0) {
        return new Response('Not found', { status: 404 });
    }

    const urls = cards
        .map(({ id, lastmod }) => {
            const path = `/card/${id}`;
            // DELIBERATELY ONE <loc> PER CARD, Thai only — unlike the sets and
            // sellers sitemaps, which emit both variants via sitemapUrlEntries().
            // This file class is ~84k URLs and most of the catalog already sits in
            // "discovered, not indexed"; doubling it would spend crawl budget on
            // English twins of a Thai-first catalog rather than on getting the Thai
            // pages indexed. The en-TH hreflang below still declares the variant.
            // Revisit only when the Thai card pages are substantially indexed.
            const th = localizedUrl(path, 'th');
            const en = localizedUrl(path, 'en');
            return (
                `<url><loc>${th}</loc>` +
                (lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : '') +
                `<xhtml:link rel="alternate" hreflang="th-TH" href="${th}"/>` +
                `<xhtml:link rel="alternate" hreflang="en-TH" href="${en}"/>` +
                `<xhtml:link rel="alternate" hreflang="x-default" href="${th}"/>` +
                `</url>`
            );
        })
        .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;
    return new Response(xml, {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' },
    });
}
