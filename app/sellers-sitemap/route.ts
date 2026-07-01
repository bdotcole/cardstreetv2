import { localizedUrl } from '@/lib/i18nRouting';
import { getActiveSellerUsernames } from '@/lib/sellerPageData';

// Public seller-shop pages (/seller/<username>) for sellers with active
// listings, each with th/en hreflang. The clean /seller/<username> URL is the
// canonical one — desktop clients render it from /desktop/seller/* internally,
// and robots.ts only blocks /desktop, so these are crawlable. Listed in
// robots.ts. Refreshed daily.
export const revalidate = 86400;

export async function GET() {
    const usernames = await getActiveSellerUsernames();
    const urls = usernames
        .map((username) => {
            // Usernames are user-controlled, so percent-encode into the path —
            // this also keeps the URL free of XML-special characters.
            const path = `/seller/${encodeURIComponent(username)}`;
            const th = localizedUrl(path, 'th');
            const en = localizedUrl(path, 'en');
            return (
                `<url><loc>${th}</loc>` +
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
