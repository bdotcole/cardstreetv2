import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getGameLanding, GAME_LANDINGS } from '@/lib/gameLanding';
import { getGame } from '@/lib/games';
import { getAllSets, type SetRow } from '@/lib/setPageData';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import { getSetLogoUrl } from '@/lib/imageUtils';

// Per-game landing pages (/pokemon, /one-piece, /yugioh, /mtg, /lorcana,
// /riftbound — middleware rewrites those clean URLs here for every device).
// These are the pages that target each game's Thai head terms (การ์ดโปเกมอน,
// การ์ดวันพีช, ...), so everything a crawler needs — copy, set links, FAQ,
// structured data — is server-rendered.

const SETS_SHOWN = 12;

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const landing = getGameLanding(slug);
    if (!landing) return { title: 'Not found | CardStreet', robots: { index: false, follow: false } };

    // Metadata follows the URL variant, never the cs_lang cookie. The bare path
    // IS the Thai canonical, so an English-cookie visitor there must still get
    // the Thai title and description — otherwise title/description and the
    // canonical + og:url below (which already use pathLocale) disagree on the
    // same URL. Same rule as /faq. The visible body stays cookie-driven.
    const pathLocale = await requestPathLocale();
    const lang = pathLocale === 'en' ? 'en' : 'th';
    return {
        metadataBase: new URL(BASE_URL),
        title: landing.title[lang],
        description: landing.description[lang],
        alternates: buildAlternates(`/${landing.slug}`, pathLocale),
        openGraph: {
            title: landing.title[lang],
            description: landing.description[lang],
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl(`/${landing.slug}`, pathLocale),
        },
    };
}

function buildJsonLd(
    landing: NonNullable<ReturnType<typeof getGameLanding>>,
    gameName: string,
    sets: SetRow[],
    pathLocale: 'th' | 'en',
) {
    const isThai = pathLocale === 'th';
    const url = localizedUrl(`/${landing.slug}`, pathLocale);
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'CardStreet', item: BASE_URL },
                    { '@type': 'ListItem', position: 2, name: gameName, item: url },
                ],
            },
            {
                '@type': 'CollectionPage',
                name: isThai ? landing.h1.th : landing.h1.en,
                url,
                inLanguage: isThai ? 'th-TH' : 'en-TH',
                isPartOf: { '@id': `${BASE_URL}/#website` },
                mainEntity: {
                    '@type': 'ItemList',
                    itemListElement: sets.map((s, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        name: s.name,
                        url: `${BASE_URL}/sets/${s.id}`,
                    })),
                },
            },
            {
                // Locale-matched, like /faq's FAQPage: answer engines quote
                // structured data verbatim, so a Thai canonical page that emits
                // English Q&A gets quoted in English to Thai searchers.
                '@type': 'FAQPage',
                inLanguage: isThai ? 'th-TH' : 'en-TH',
                mainEntity: landing.faqs.map((f) => ({
                    '@type': 'Question',
                    name: isThai ? f.q.th : f.q.en,
                    acceptedAnswer: { '@type': 'Answer', text: isThai ? f.a.th : f.a.en },
                })),
            },
        ],
    };
}

export default async function GameLandingPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const landing = getGameLanding(slug);
    if (!landing) notFound();

    const lang = await resolveLang();
    const isThai = lang === 'TH';
    const l = isThai ? ('th' as const) : ('en' as const);
    // Structured data is a search-engine artifact, so it follows the URL variant
    // like the metadata does, not the visitor's cookie.
    const pathLocale = await requestPathLocale();
    const game = getGame(landing.gameId);

    const allSets = await getAllSets();
    const gameSets = allSets.filter((s) => s.game === landing.gameId);
    const newest = gameSets.slice(0, SETS_SHOWN);
    const cardCount = gameSets.reduce((sum, s) => sum + (s.total || s.printed_total || 0), 0);

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(landing, game.name, newest, pathLocale)) }}
            />

            <nav className="text-xs text-slate-500 mb-6" aria-label="Breadcrumb">
                <Link href="/" className="hover:text-slate-300 transition-colors">CardStreet</Link>
                <span className="mx-2">/</span>
                <span className="text-slate-300">{game.name}</span>
            </nav>

            <header className="mb-8">
                <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">{landing.h1[l]}</h1>
                {gameSets.length > 0 && (
                    <p className="mt-2 text-sm text-slate-400 font-bold">
                        {isThai
                            ? `${gameSets.length.toLocaleString()} ชุด · การ์ดกว่า ${cardCount.toLocaleString()} ใบในแคตตาล็อก`
                            : `${gameSets.length.toLocaleString()} sets · ${cardCount.toLocaleString()}+ cards in the catalog`}
                    </p>
                )}
            </header>

            <section className="max-w-3xl space-y-4 text-sm md:text-base text-slate-300 leading-relaxed">
                {landing.intro[l].map((p) => (
                    <p key={p.slice(0, 24)}>{p}</p>
                ))}
            </section>

            {newest.length > 0 && (
                <section className="mt-12">
                    <div className="flex items-center justify-between gap-4 mb-4">
                        <h2 className="text-xl font-black text-white">
                            {isThai ? 'ชุดการ์ดล่าสุด' : 'Latest sets'}
                        </h2>
                        <Link href="/sets" className="text-xs font-bold text-brand-cyan hover:text-cyan-300 transition-colors">
                            {isThai ? 'ดูทุกชุด →' : 'Browse all sets →'}
                        </Link>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {newest.map((s) => {
                            const logo = s.logo_url ? getSetLogoUrl(s.logo_url, 160, 80) : null;
                            return (
                                <Link
                                    key={`${s.id}-${s.language}`}
                                    href={`/sets/${s.id}`}
                                    className="flex items-center gap-3 bg-slate-800/40 border border-white/5 rounded-xl p-3 hover:border-brand-cyan/40 transition-colors"
                                >
                                    <span className="w-16 h-10 shrink-0 flex items-center justify-center">
                                        {logo ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={logo} alt="" loading="lazy" className="max-w-full max-h-full object-contain" />
                                        ) : (
                                            <span className="text-[10px] font-black text-slate-600 uppercase">{s.id}</span>
                                        )}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-bold text-white truncate">{s.name}</span>
                                        <span className="block text-[11px] text-slate-500">
                                            {(s.total || s.printed_total || 0)} {isThai ? 'ใบ' : 'cards'}
                                            {s.language !== 'en' ? ` · ${s.language.toUpperCase()}` : ''}
                                        </span>
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            )}

            <section className="mt-12 max-w-3xl">
                <h2 className="text-xl font-black text-white mb-4">
                    {isThai ? 'คำถามที่พบบ่อย' : 'Frequently asked questions'}
                </h2>
                <div className="space-y-2">
                    {landing.faqs.map((f) => (
                        <details key={f.q.en} className="group bg-slate-800/40 border border-white/5 rounded-xl">
                            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-white flex items-center justify-between gap-3">
                                {f.q[l]}
                                <i className="fa-solid fa-chevron-down text-[10px] text-slate-500 group-open:rotate-180 transition-transform"></i>
                            </summary>
                            <p className="px-4 pb-4 text-sm text-slate-300 leading-relaxed">{f.a[l]}</p>
                        </details>
                    ))}
                </div>
            </section>

            <section className="mt-12">
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-wide mb-3">
                    {isThai ? 'เกมการ์ดอื่น ๆ บน CardStreet' : 'Other card games on CardStreet'}
                </h2>
                <div className="flex flex-wrap gap-2">
                    {GAME_LANDINGS.filter((g) => g.slug !== landing.slug).map((g) => (
                        <Link
                            key={g.slug}
                            href={`/${g.slug}`}
                            className="px-4 py-1.5 rounded-full text-xs font-bold bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10 transition-colors"
                        >
                            {getGame(g.gameId).name}
                        </Link>
                    ))}
                </div>
            </section>
        </>
    );
}
