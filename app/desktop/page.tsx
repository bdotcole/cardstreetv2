import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import DesktopMarketplace from '@/components/desktop/DesktopMarketplace';
import { GAME_LANDINGS } from '@/lib/gameLanding';
import { getGame } from '@/lib/games';
import { buildAlternatesForRequest, localePrefix, requestPathLocale } from '@/lib/i18nRouting';

// Homepage canonical + hreflang (title/description come from the root layout's
// localized generateMetadata — this is the same URL the mobile SPA serves, so
// both experiences share one canonical).
export async function generateMetadata(): Promise<Metadata> {
    return { alternates: await buildAlternatesForRequest('/') };
}

// Server-rendered game directory under the (client-fetched) marketplace grid.
// This is the homepage's crawlable content: links + copy that exist in the
// initial HTML without JavaScript.
async function GameDirectory() {
    // Two different axes, deliberately read from two different places:
    // the COPY follows the visitor's UI language (x-cs-lang, which the language
    // toggle can flip on a bare URL), while the LINKS follow the URL prefix, so
    // the /en homepage keeps crawlers inside the /en tree and the bare Thai
    // homepage never emits /en links regardless of cookie state.
    const isThai = (await headers()).get('x-cs-lang') !== 'EN';
    const pathPrefix = localePrefix(await requestPathLocale());
    return (
        <section className="mt-14">
            <h2 className="text-xl font-black text-white mb-1">
                {isThai ? 'เลือกดูตามเกมการ์ด' : 'Browse by card game'}
            </h2>
            <p className="text-sm text-slate-400 mb-5">
                {isThai
                    ? 'ซื้อ ขาย และเช็คราคาการ์ดสะสมทุกเกมในไทย — ผู้ขายยืนยันตัวตน ส่งทั่วประเทศ'
                    : 'Buy, sell, and check prices for every trading card game in Thailand — verified sellers, nationwide delivery.'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {GAME_LANDINGS.map((g) => {
                    const game = getGame(g.gameId);
                    return (
                        <Link
                            key={g.slug}
                            href={`${pathPrefix}/${g.slug}`}
                            className={`rounded-xl p-4 bg-gradient-to-br ${game.gradient} border border-white/10 hover:border-white/30 transition-colors`}
                        >
                            <span className={`block text-sm font-black ${game.textColor}`}>{game.name}</span>
                            <span className={`block mt-1 text-[11px] font-bold ${game.textColor} opacity-80`}>
                                {isThai ? 'ซื้อ · ขาย · เช็คราคา' : 'Buy · Sell · Prices'}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}

// Suspense boundary required: DesktopMarketplace reads useSearchParams().
export default async function DesktopHomePage() {
    // Resolved here and passed down as a plain string: lib/i18nRouting imports
    // next/headers, so a client component cannot import it itself.
    const pathPrefix = localePrefix(await requestPathLocale());
    return (
        <>
            <Suspense>
                <DesktopMarketplace pathPrefix={pathPrefix} />
            </Suspense>
            <GameDirectory />
        </>
    );
}
