import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { GUIDES } from '@/lib/guides';
import { getGameLabel } from '@/lib/games';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';

// Guides index. Its job is to be the crawl entry point to every guide, the same
// way /sets is the entry point to ~1k set pages.

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale !== 'en';
    const title = isThai
        ? 'คู่มือและบทความการ์ดสะสม — เช็คราคา ดูของแท้ ระดับความหายาก | CardStreet'
        : 'Trading Card Guides — Prices, Authenticity and Rarity | CardStreet';
    const description = isThai
        ? 'บทความภาษาไทยสำหรับนักสะสมการ์ด ทั้งวิธีเช็คราคา ดูการ์ดปลอม ระดับความหายาก และซื้อขายในไทยอย่างปลอดภัย'
        : 'Guides for card collectors in Thailand: how to check prices, spot fakes, read rarity tiers, and buy and sell safely.';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/guides', pathLocale),
        openGraph: { title, description, type: 'website', siteName: 'CardStreet', url: localizedUrl('/guides', pathLocale) },
    };
}

export default async function GuidesIndexPage() {
    const lang = await resolveLang();
    const isThai = lang === 'TH';
    const l = isThai ? ('th' as const) : ('en' as const);
    const pathLocale = await requestPathLocale();
    const prefix = localePrefix(pathLocale);

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'CardStreet', item: BASE_URL },
                    { '@type': 'ListItem', position: 2, name: isThai ? 'คู่มือ' : 'Guides', item: localizedUrl('/guides', pathLocale) },
                ],
            },
            {
                '@type': 'CollectionPage',
                name: isThai ? 'คู่มือและบทความการ์ดสะสม' : 'Trading card guides',
                url: localizedUrl('/guides', pathLocale),
                inLanguage: isThai ? 'th-TH' : 'en-TH',
                isPartOf: { '@id': `${BASE_URL}/#website` },
                mainEntity: {
                    '@type': 'ItemList',
                    itemListElement: GUIDES.map((g, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        name: g.h1[l],
                        url: localizedUrl(`/guides/${g.slug}`, pathLocale),
                    })),
                },
            },
        ],
    };

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            <nav className="text-xs text-slate-500 mb-6" aria-label="Breadcrumb">
                <Link href={prefix || '/'} className="hover:text-slate-300 transition-colors">CardStreet</Link>
                <span className="mx-2">/</span>
                <span className="text-slate-300">{isThai ? 'คู่มือ' : 'Guides'}</span>
            </nav>

            <header className="mb-8 max-w-3xl">
                <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                    {isThai ? 'คู่มือและบทความการ์ดสะสม' : 'Trading card guides'}
                </h1>
                <p className="mt-3 text-sm md:text-base text-slate-300 leading-relaxed">
                    {isThai
                        ? 'บทความสำหรับนักสะสมในไทย เขียนจากข้อมูลราคาจริงในแคตตาล็อกของเรา ไม่ใช่ตัวเลขที่คัดลอกกันมา'
                        : 'Written for collectors in Thailand, from the real price data in our own catalog rather than figures copied from elsewhere.'}
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                {GUIDES.map((g) => (
                    <Link
                        key={g.slug}
                        href={`${prefix}/guides/${g.slug}`}
                        className="block rounded-xl border border-white/10 bg-white/[0.03] hover:border-brand-cyan/40 hover:bg-white/[0.06] transition-colors p-5"
                    >
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-brand-cyan">
                            {getGameLabel(g.game, isThai ? 'th' : 'en')}
                        </span>
                        <span className="block mt-2 text-base font-black text-white">{g.h1[l]}</span>
                        <span className="block mt-2 text-xs text-slate-400 leading-relaxed">{g.description[l]}</span>
                    </Link>
                ))}
            </div>
        </>
    );
}
