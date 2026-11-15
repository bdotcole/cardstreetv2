import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getSetBrowserData } from '@/lib/setPageData';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL, DEFAULT_OG_IMAGE } from '@/lib/i18nRouting';
import DesktopSetsBrowser from '@/components/desktop/DesktopSetsBrowser';

// How long after release a set keeps its "New" badge in the browser.
const NEW_SET_DAYS = 45;

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'Browse Trading Card Sets | Cardstreet' : 'เลือกชมชุดการ์ดทั้งหมด | Cardstreet';
    const description =
        lang === 'EN'
            ? 'Browse every Pokémon, Yu-Gi-Oh!, Magic, One Piece, Riftbound, and Lorcana set on Cardstreet. Live prices and listings for every card, with nationwide shipping in Thailand.'
            : 'เลือกชมชุดการ์ดโปเกมอน ยูกิโอ เมจิก วันพีช Riftbound และ Lorcana ทั้งหมดบน Cardstreet ราคาและรายการขายของทุกใบ จัดส่งทั่วไทย';
    const pathLocale = await requestPathLocale();
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/sets', pathLocale),
        openGraph: { title, description, type: 'website', siteName: 'Cardstreet', url: localizedUrl('/sets', pathLocale), images: DEFAULT_OG_IMAGE },
    };
}

export default async function DesktopSetsIndexPage() {
    const lang = await resolveLang();
    const sets = await getSetBrowserData();
    // The "New" badge window. Dates are computed here and handed down as
    // strings so the server render and the first client render agree on them.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const newSince = new Date(now.getTime() - NEW_SET_DAYS * 86_400_000).toISOString().slice(0, 10);
    // Links and structured-data URLs follow the URL variant being served, not
    // the cookie language: /en/sets must link to /en/sets/<id>, or the English
    // tree dead-ends at depth 1.
    const pathLocale = await requestPathLocale();
    const prefix = localePrefix(pathLocale);

    // schema.org CollectionPage listing the newest sets (capped — the full
    // catalog is ~1k sets and the links are all server-rendered below anyway).
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Trading Card Sets',
        url: localizedUrl('/sets', pathLocale),
        isPartOf: { '@id': `${BASE_URL}/#website` },
        mainEntity: {
            '@type': 'ItemList',
            itemListElement: sets.slice(0, 50).map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: s.name,
                url: localizedUrl(`/sets/${s.id}`, pathLocale),
            })),
        },
    };

    return (
        <div>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <h1 className="text-2xl font-black text-white">{lang === 'EN' ? 'Trading Card Sets' : 'ชุดการ์ดทั้งหมด'}</h1>
            <p className="text-sm text-slate-400 mt-1">
                {lang === 'EN'
                    ? 'Pick a game and a language, then a set, to browse its cards, prices, and listings.'
                    : 'เลือกเกมและภาษา แล้วเลือกชุดเพื่อดูการ์ด ราคา และรายการขาย'}
            </p>

            {/* No Suspense boundary, unlike the other pages whose client
                component reads useSearchParams(). This route is rendered per
                request (headers() above), where the hook needs none, and a
                boundary makes React stream the browser after the footer as a
                hidden segment that a script moves into place. Left inline, the
                1,400 set links this page exists to carry sit in the HTML
                where a crawler that runs no script still reads them in order. */}
            <DesktopSetsBrowser sets={sets} pathPrefix={prefix} today={today} newSince={newSince} />
        </div>
    );
}
