import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getAllSets } from '@/lib/setPageData';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL, DEFAULT_OG_IMAGE } from '@/lib/i18nRouting';
import DesktopSetsBrowser from '@/components/desktop/DesktopSetsBrowser';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'Browse Trading Card Sets | CardStreet' : 'เลือกชมชุดการ์ดทั้งหมด | CardStreet';
    const description =
        lang === 'EN'
            ? 'Browse every Pokémon, Yu-Gi-Oh!, Magic, One Piece, Riftbound, and Lorcana set on CardStreet. Live prices and listings for every card, with nationwide shipping in Thailand.'
            : 'เลือกชมชุดการ์ดโปเกมอน ยูกิโอ เมจิก วันพีช Riftbound และ Lorcana ทั้งหมดบน CardStreet ราคาและรายการขายของทุกใบ จัดส่งทั่วไทย';
    const pathLocale = await requestPathLocale();
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/sets', pathLocale),
        openGraph: { title, description, type: 'website', siteName: 'CardStreet', url: localizedUrl('/sets', pathLocale), images: DEFAULT_OG_IMAGE },
    };
}

export default async function DesktopSetsIndexPage() {
    const lang = await resolveLang();
    const sets = await getAllSets();
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
                    ? 'Every set across all games. Filter by game and language, then pick a set to browse its cards, prices, and listings.'
                    : 'ชุดการ์ดทั้งหมดของทุกเกม กรองตามเกมและภาษา แล้วเลือกชุดเพื่อดูการ์ด ราคา และรายการขาย'}
            </p>

            <DesktopSetsBrowser sets={sets} pathPrefix={prefix} />
        </div>
    );
}
