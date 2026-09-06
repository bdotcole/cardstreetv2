import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSetPageData, type SetRow } from '@/lib/setPageData';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import { getSetLogoUrl } from '@/lib/imageUtils';
import { getGameLabel, thaiCardNoun } from '@/lib/games';
import { getSetIntro } from '@/lib/setLanding';
import { buildSetSummary } from '@/lib/setSummary';
import DesktopSetCards from '@/components/desktop/DesktopSetCards';
import LandingCtaRow from '@/components/desktop/LandingCtaRow';
import type { Card } from '@/types';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

// Localized game names come from lib/games.ts. The Thai forms matter: the TH
// title reads "การ์ด<game>", so an English label there produced mixed-script
// titles like "การ์ดPokémon".
function gameLabel(game: string, lang: 'EN' | 'TH'): string {
    return getGameLabel(game, lang === 'EN' ? 'en' : 'th');
}


export async function generateMetadata({ params }: { params: Promise<{ setId: string }> }): Promise<Metadata> {
    const { setId } = await params;
    const { set, cards } = await getSetPageData(setId);
    if (!set) return { title: 'Set not found | CardStreet', robots: { index: false, follow: false } };

    const lang = await resolveLang();
    const count = cards.length || set.printed_total || set.total || 0;
    const game = gameLabel(set.game, lang);
    const title =
        lang === 'EN'
            ? `${set.name} — ${game} Cards & Prices | CardStreet`
            : `${set.name} — ${thaiCardNoun(set.game)} เช็คราคาและรายการขาย | CardStreet`;
    const description =
        lang === 'EN'
            ? `Browse all ${count} ${set.name} ${game} cards with live market prices and listings from verified sellers. Buy and sell on CardStreet with nationwide shipping in Thailand.`
            : `เลือกชมการ์ด ${set.name} (${game}) ทั้งหมด ${count} ใบ พร้อมราคาตลาดเรียลไทม์และรายการขายจากผู้ขายที่ยืนยันแล้ว ซื้อขายบน CardStreet จัดส่งทั่วไทย`;

    const ogImage = set.logo_url ? getSetLogoUrl(set.logo_url, 600, 85) : undefined;

    const pathLocale = await requestPathLocale();
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates(`/sets/${setId}`, pathLocale),
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl(`/sets/${setId}`, pathLocale),
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
    };
}

// schema.org ItemList — declares the set's cards (and their URLs) so search and
// AI answer engines see this as a structured collection. Capped to keep the
// payload bounded; the full set is linked as crawlable HTML below regardless.
function buildItemListJsonLd(set: SetRow, cards: Card[], lang: 'EN' | 'TH', pathLocale: 'th' | 'en') {
    const items = cards.slice(0, 100).map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        // Must follow the URL variant being served — the /en page previously
        // listed 210 Thai card URLs in its structured data.
        url: localizedUrl(`/card/${c.id}`, pathLocale),
        name: c.name,
    }));
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        // This read `GAME_LABEL[set.game]` — the whole {en, th} object — so every
        // set page shipped "<set> — [object Object]" in its structured data.
        name: `${set.name} — ${gameLabel(set.game, lang)}`,
        inLanguage: lang === 'EN' ? 'en-TH' : 'th-TH',
        numberOfItems: cards.length,
        itemListElement: items,
    };
}

export default async function DesktopSetPage({ params }: { params: Promise<{ setId: string }> }) {
    const { setId } = await params;
    const { set, cards } = await getSetPageData(setId);
    if (!set) notFound();

    const lang = await resolveLang();
    const game = gameLabel(set.game, lang);
    const logo = set.logo_url ? getSetLogoUrl(set.logo_url, 300, 85) : null;
    const intro = getSetIntro(setId);
    const summary = buildSetSummary(set, cards, lang);
    // Internal links follow the URL variant, not the cookie language: on
    // /en/sets/<id> the breadcrumbs and the card grid must stay inside /en.
    const pathLocale = await requestPathLocale();
    const prefix = localePrefix(pathLocale);

    return (
        <div>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemListJsonLd(set, cards, lang, pathLocale)) }}
            />

            <nav className="text-sm text-slate-500">
                <Link href={prefix || '/'} className="hover:text-slate-300 transition-colors">{lang === 'EN' ? 'Marketplace' : 'มาร์เก็ตเพลส'}</Link>
                <span className="mx-2">›</span>
                <Link href={`${prefix}/sets`} className="hover:text-slate-300 transition-colors">{lang === 'EN' ? 'Sets' : 'ชุดการ์ด'}</Link>
                <span className="mx-2">›</span>
                <span className="text-slate-300">{set.name}</span>
            </nav>

            <header className="flex items-center gap-5 mt-6">
                {logo && (
                    <div className="relative w-28 h-16 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo} alt={set.name} className="w-full h-full object-contain object-left" />
                    </div>
                )}
                <div>
                    <h1 className="text-2xl font-black text-white">{set.name}</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {game}
                        {` · ${cards.length} ${lang === 'EN' ? 'cards' : 'ใบ'}`}
                        {set.release_date ? ` · ${new Date(set.release_date).getFullYear()}` : ''}
                    </p>
                </div>
            </header>

            {intro && (
                <p className="text-sm text-slate-400 leading-relaxed mt-6 max-w-3xl">
                    {lang === 'EN' ? intro.en : intro.th}
                </p>
            )}

            {summary && (
                <p className="text-sm text-slate-500 leading-relaxed mt-3 max-w-3xl">
                    {summary}
                </p>
            )}

            {cards.length === 0 ? (
                <p className="text-slate-500 text-sm mt-10">{lang === 'EN' ? 'No cards found for this set.' : 'ไม่พบการ์ดในชุดนี้'}</p>
            ) : (
                <DesktopSetCards cards={cards} pathPrefix={prefix} />
            )}

            {/* Below the grid here, not above it: a set page's job is the card
                list, and a reader who scrolls the whole set is the one worth
                asking. The game landings put the same row after the intro,
                where the shape of the page is different. */}
            <LandingCtaRow
                lang={lang}
                prefix={prefix}
                gameId={set.game}
                browseLabel={{
                    en: `Browse ${gameLabel(set.game, 'EN')} listings`,
                    th: `ดู${thaiCardNoun(set.game)}ที่ประกาศขาย`,
                }}
            />
        </div>
    );
}
