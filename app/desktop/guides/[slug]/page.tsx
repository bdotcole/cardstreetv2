import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getGuide, getGuidesForGame, GUIDES } from '@/lib/guides';
import { getGameLanding } from '@/lib/gameLanding';
import { getGameLabel } from '@/lib/games';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';

// Long-form guides. /guides/<slug> is rewritten here by middleware for every
// device (PUBLIC_CONTENT_PREFIXES), same as /card, /sets and /seller — Google
// indexes with its smartphone crawler, and a phone redirect is what made the
// catalog invisible in mid-2026. Do not add one.

export function generateStaticParams() {
    return GUIDES.map((g) => ({ slug: g.slug }));
}

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const guide = getGuide(slug);
    if (!guide) return { title: 'Not found | CardStreet', robots: { index: false, follow: false } };

    // Metadata follows the URL variant, never the cs_lang cookie — the bare path
    // IS the Thai canonical, so an English-cookie visitor there still gets Thai
    // metadata. Same rule as the game landings and /faq.
    const pathLocale = await requestPathLocale();
    const lang = pathLocale === 'en' ? 'en' : 'th';
    return {
        metadataBase: new URL(BASE_URL),
        title: guide.title[lang],
        description: guide.description[lang],
        alternates: buildAlternates(`/guides/${guide.slug}`, pathLocale),
        openGraph: {
            title: guide.title[lang],
            description: guide.description[lang],
            type: 'article',
            siteName: 'CardStreet',
            url: localizedUrl(`/guides/${guide.slug}`, pathLocale),
        },
    };
}

function buildJsonLd(guide: NonNullable<ReturnType<typeof getGuide>>, gameName: string, pathLocale: 'th' | 'en') {
    const isThai = pathLocale === 'th';
    const url = localizedUrl(`/guides/${guide.slug}`, pathLocale);
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'CardStreet', item: BASE_URL },
                    { '@type': 'ListItem', position: 2, name: gameName, item: localizedUrl(`/${guide.game}`, pathLocale) },
                    { '@type': 'ListItem', position: 3, name: guide.h1[isThai ? 'th' : 'en'], item: url },
                ],
            },
            {
                '@type': 'Article',
                headline: guide.h1[isThai ? 'th' : 'en'],
                description: guide.description[isThai ? 'th' : 'en'],
                // Locale-matched: answer engines quote structured data verbatim, so a
                // Thai canonical emitting English prose gets quoted in English.
                inLanguage: isThai ? 'th-TH' : 'en-TH',
                articleBody: guide.body[isThai ? 'th' : 'en'].join('\n\n'),
                dateModified: guide.updated,
                mainEntityOfPage: { '@type': 'WebPage', '@id': url },
                isPartOf: { '@id': `${BASE_URL}/#website` },
                publisher: { '@type': 'Organization', name: 'CardStreet', url: BASE_URL },
            },
        ],
    };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const guide = getGuide(slug);
    if (!guide) notFound();

    const lang = await resolveLang();
    const isThai = lang === 'TH';
    const l = isThai ? ('th' as const) : ('en' as const);
    const pathLocale = await requestPathLocale();
    const prefix = localePrefix(pathLocale);
    const gameName = getGameLabel(guide.game, isThai ? 'th' : 'en');
    const landing = getGameLanding(guide.game);
    const siblings = getGuidesForGame(guide.game).filter((g) => g.slug !== guide.slug);

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(guide, gameName, pathLocale)) }}
            />

            <nav className="text-xs text-slate-500 mb-6" aria-label="Breadcrumb">
                <Link href={prefix || '/'} className="hover:text-slate-300 transition-colors">CardStreet</Link>
                <span className="mx-2">/</span>
                <Link href={`${prefix}/guides`} className="hover:text-slate-300 transition-colors">
                    {isThai ? 'คู่มือ' : 'Guides'}
                </Link>
                {landing && (
                    <>
                        <span className="mx-2">/</span>
                        <Link href={`${prefix}/${landing.slug}`} className="hover:text-slate-300 transition-colors">{gameName}</Link>
                    </>
                )}
            </nav>

            <article className="max-w-3xl">
                <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">{guide.h1[l]}</h1>
                <p className="mt-3 text-sm text-slate-400">
                    {isThai ? 'อัปเดตล่าสุด' : 'Last updated'} {guide.updated}
                </p>

                <div className="mt-8 space-y-4 text-sm md:text-base text-slate-300 leading-relaxed">
                    {guide.body[l].map((p) => (
                        <p key={p.slice(0, 32)}>{p}</p>
                    ))}
                </div>

                {landing && (
                    <div className="mt-10 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-5">
                        <p className="text-sm text-slate-200">
                            {isThai
                                ? 'เช็คราคาตลาดล่าสุดของการ์ดทุกใบที่พูดถึงในบทความนี้ได้ฟรี ไม่ต้องสมัครสมาชิก'
                                : 'Check a live market price for every card named in this guide, free and without an account.'}
                        </p>
                        <Link
                            href={`${prefix}/${landing.slug}`}
                            className="inline-block mt-3 text-sm font-bold text-brand-cyan hover:text-white transition-colors"
                        >
                            {isThai ? `ดูการ์ด ${gameName} ทั้งหมด →` : `Browse all ${gameName} cards →`}
                        </Link>
                    </div>
                )}
            </article>

            {siblings.length > 0 && (
                <section className="mt-12 max-w-3xl border-t border-white/10 pt-8">
                    <h2 className="text-lg font-black text-white mb-4">
                        {isThai ? 'บทความอื่นที่เกี่ยวข้อง' : 'More guides'}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {siblings.map((g) => (
                            <Link
                                key={g.slug}
                                href={`${prefix}/guides/${g.slug}`}
                                className="block rounded-xl border border-white/10 bg-white/[0.03] hover:border-brand-cyan/40 hover:bg-white/[0.06] transition-colors p-4"
                            >
                                <span className="block text-sm font-bold text-white">{g.h1[l]}</span>
                                <span className="block mt-1 text-xs text-slate-400 line-clamp-2">{g.description[l]}</span>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
        </>
    );
}
