import Link from 'next/link';
import { PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/lib/appLinks';

/**
 * The three next steps a visitor to a public content page can take.
 *
 * The game landings and set pages rank and get read, then dead-end: their only
 * outbound links go to more content (other sets, other games, guides). A page
 * that answers "what is this card worth" without ever offering to sell it, buy
 * it, or put the app on the reader's phone converts nothing — and these pages
 * are the large majority of search arrivals.
 *
 * Server component on purpose: no state, and these pages are server-rendered,
 * so the links sit in the HTML a crawler sees. `lang` is the visitor's cookie
 * language (what the surrounding copy is in); `prefix` is the URL locale, so
 * internal links stay inside the tree the visitor is already in.
 */
export default function LandingCtaRow({
    lang,
    prefix = '',
    // Deep-links the marketplace filter (?game=) when the page is about one
    // game. Omit on pages that are not.
    gameId,
    browseLabel,
}: {
    lang: 'EN' | 'TH';
    prefix?: string;
    gameId?: string;
    browseLabel?: { en: string; th: string };
}) {
    const isThai = lang === 'TH';
    const browseHref = `${prefix || '/'}${gameId ? `?game=${gameId}` : ''}`;

    const cardClass =
        'block rounded-2xl border border-white/10 bg-white/[0.03] hover:border-brand-cyan/40 hover:bg-white/[0.06] transition-colors p-5';

    return (
        <section className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href={browseHref} className={cardClass}>
                <i className="fa-solid fa-store text-brand-cyan"></i>
                <span className="block mt-3 text-sm font-black text-white">
                    {browseLabel
                        ? (isThai ? browseLabel.th : browseLabel.en)
                        : isThai ? 'ดูการ์ดที่ประกาศขาย' : 'Browse listings'}
                </span>
                <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                    {isThai
                        ? 'ราคาจริงจากผู้ขายที่ยืนยันแล้ว จัดส่งทั่วไทย'
                        : 'Live prices from verified sellers, shipped nationwide.'}
                </span>
            </Link>

            <Link href={`${prefix}/sell-cards`} className={cardClass}>
                <i className="fa-solid fa-tag text-brand-cyan"></i>
                <span className="block mt-3 text-sm font-black text-white">
                    {isThai ? 'ขายการ์ดของคุณ' : 'Sell your cards'}
                </span>
                <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                    {isThai
                        ? 'ลงประกาศฟรี เสียค่าธรรมเนียมเฉพาะตอนขายได้'
                        : 'Free to list — you only pay a fee when a card sells.'}
                </span>
            </Link>

            {/* Both stores, side by side rather than one UA-guessed link: this
                is server-rendered and cached, so it cannot know the device. */}
            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-cyan/[0.06] p-5">
                <i className="fa-solid fa-mobile-screen text-brand-cyan"></i>
                <span className="block mt-3 text-sm font-black text-white">
                    {isThai ? 'โหลดแอป CardStreet' : 'Get the app'}
                </span>
                <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                    {isThai
                        ? 'สแกนการ์ดด้วยกล้อง เช็คราคา และเก็บคอลเลกชันไว้ในมือถือ'
                        : 'Scan cards with your camera, check prices, track your collection.'}
                </span>
                <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold">
                    <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-brand-cyan hover:underline">
                        Google Play
                    </a>
                    <span className="text-slate-600">·</span>
                    <a href={IOS_APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-brand-cyan hover:underline">
                        App Store
                    </a>
                </span>
            </div>
        </section>
    );
}
