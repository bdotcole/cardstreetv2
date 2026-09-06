import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getActiveShops } from '@/lib/sellerPageData';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL, DEFAULT_OG_IMAGE } from '@/lib/i18nRouting';

// Seller shop directory (/shops — middleware rewrites the clean URL here for
// every device, like the other public content pages).
//
// WHY THIS PAGE EXISTS
// Measured 2026-09-01: the seller pages holding the entire active inventory had
// ZERO internal links from any content page — no link from /, /pokemon, /prices,
// /sets, /guides, /graded or /faq — and were reachable only through
// sellers-sitemap. With 222 active listings against 117,322 card pages, the
// shops are the scarce convertible surface on the site and they had no crawl
// path at all.
//
// It also targets ร้านขายการ์ด / ร้านการ์ดออนไลน์, a tracked query the domain
// does not currently rank for and which no existing page addresses.
//
// Nothing here is hardcoded: the shop list, counts and "from" prices all come
// from live listings, so the page cannot go stale and cannot advertise a shop
// that has sold out.

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale !== 'en';
    const title = isThai
        ? 'ร้านขายการ์ดบน CardStreet — ผู้ขายยืนยันตัวตน ส่งทั่วไทย | CardStreet'
        : 'Card Shops on CardStreet — Verified Sellers Across Thailand | CardStreet';
    const description = isThai
        ? 'รวมร้านขายการ์ดสะสมบน CardStreet ทั้งการ์ดโปเกมอน วันพีช ยูกิ Magic และ Lorcana ผู้ขายทุกร้านยืนยันตัวตนแล้ว ดูของที่มีขายจริงตอนนี้ เช็คราคาก่อนซื้อ ส่งทั่วไทย'
        : 'Every shop selling trading cards on CardStreet — Pokémon, One Piece, Yu-Gi-Oh!, Magic and Lorcana. All sellers are identity-verified. See what is actually in stock right now, with market prices to compare against.';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/shops', pathLocale),
        openGraph: {
            images: DEFAULT_OG_IMAGE,
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl('/shops', pathLocale),
        },
    };
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString('en-US')}`;

export default async function ShopsDirectoryPage() {
    const lang = await resolveLang();
    const isThai = lang === 'TH';
    const pathLocale = await requestPathLocale();
    const prefix = localePrefix(pathLocale);
    const shops = await getActiveShops();

    const totalListings = shops.reduce((n, s) => n + s.listingCount, 0);

    // ItemList of OnlineStore — the seller pages already declare OnlineStore
    // individually, so the directory declares the collection of them.
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: isThai ? 'ร้านขายการ์ดบน CardStreet' : 'Card shops on CardStreet',
        inLanguage: isThai ? 'th-TH' : 'en-TH',
        numberOfItems: shops.length,
        itemListElement: shops.slice(0, 100).map((s, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
                '@type': 'OnlineStore',
                name: s.displayName,
                url: localizedUrl(`/seller/${encodeURIComponent(s.username)}`, pathLocale),
            },
        })),
    };

    return (
        <div>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            <nav className="text-xs text-slate-500 mb-6" aria-label="Breadcrumb">
                <Link href={prefix || '/'} className="hover:text-slate-300 transition-colors">CardStreet</Link>
                <span className="mx-2">/</span>
                <span className="text-slate-300">{isThai ? 'ร้านขายการ์ด' : 'Card shops'}</span>
            </nav>

            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                    {isThai ? 'ร้านขายการ์ดบน CardStreet' : 'Card shops on CardStreet'}
                </h1>
                {shops.length > 0 && (
                    <p className="mt-2 text-sm text-slate-400 font-bold">
                        {isThai
                            ? `${shops.length} ร้าน · ${totalListings.toLocaleString()} รายการที่มีขายตอนนี้`
                            : `${shops.length} shops · ${totalListings.toLocaleString()} cards in stock right now`}
                    </p>
                )}
            </header>

            <section className="max-w-3xl space-y-4 text-sm md:text-base text-slate-300 leading-relaxed">
                {isThai ? (
                    <>
                        <p>
                            ทุกร้านในหน้านี้เป็นผู้ขายที่ยืนยันตัวตนกับ CardStreet แล้ว และรายการที่เห็นคือของที่มีขายจริงในตอนนี้ ไม่ใช่แคตตาล็อกเปล่า
                            กดเข้าไปในร้านเพื่อดูว่าเขามีการ์ดใบไหนอยู่บ้าง พร้อมราคาและสภาพของแต่ละใบ
                        </p>
                        <p>
                            ทุกใบมีราคาตลาดกำกับไว้ให้เทียบก่อนตัดสินใจ จะได้รู้ว่าที่กำลังจะจ่ายนั้นสูงหรือต่ำกว่าราคากลางเท่าไหร่ ชำระเงินผ่านระบบที่ปลอดภัยมีการคุ้มครองผู้ซื้อ
                            และจัดส่งทั่วไทยผ่าน Flash Express พร้อมเลขติดตามพัสดุทุกออเดอร์
                        </p>
                        <p>
                            อยากเปิดร้านของตัวเองบ้าง ลงขายได้ฟรีที่หน้า{' '}
                            <Link href={`${prefix}/sell-cards`} className="text-brand-cyan hover:text-cyan-300 transition-colors">ขายการ์ด</Link>
                        </p>
                    </>
                ) : (
                    <>
                        <p>
                            Every shop here is an identity-verified CardStreet seller, and what you see is what is actually in stock
                            right now rather than an empty catalog. Open a shop to see the cards they are holding, with the price and
                            condition of each one.
                        </p>
                        <p>
                            Every card carries a market price to compare against, so you can see whether you are paying above or below
                            the going rate. Checkout is secure with buyer protection, and orders ship nationwide via Flash Express with
                            tracking.
                        </p>
                        <p>
                            Want your own shop? Listing is free —{' '}
                            <Link href={`${prefix}/sell-cards`} className="text-brand-cyan hover:text-cyan-300 transition-colors">start selling</Link>.
                        </p>
                    </>
                )}
            </section>

            {shops.length === 0 ? (
                <p className="text-slate-500 text-sm mt-10">
                    {isThai ? 'ตอนนี้ยังไม่มีร้านที่เปิดขายอยู่' : 'No shops have active listings right now.'}
                </p>
            ) : (
                <section className="mt-10">
                    <h2 className="text-xl font-black text-white mb-4">
                        {isThai ? 'ร้านที่มีของขายตอนนี้' : 'Shops with stock right now'}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {shops.map((s) => (
                            <Link
                                key={s.username}
                                href={`${prefix}/seller/${encodeURIComponent(s.username)}`}
                                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-brand-cyan/40 hover:bg-white/[0.06] transition-colors p-4"
                            >
                                {s.avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={s.avatarUrl} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover shrink-0" />
                                ) : (
                                    <span className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
                                )}
                                <span className="min-w-0">
                                    <span className="block text-sm font-bold text-white truncate">
                                        {s.displayName}
                                        {s.isVerified && (
                                            <i className="fa-solid fa-circle-check text-brand-cyan text-[11px] ml-1.5" aria-hidden="true"></i>
                                        )}
                                    </span>
                                    <span className="block text-[11px] text-slate-500">
                                        {isThai ? `${s.listingCount} รายการ` : `${s.listingCount} listing${s.listingCount === 1 ? '' : 's'}`}
                                        {s.fromPrice !== null && ` · ${isThai ? 'เริ่มต้น' : 'from'} ${baht(s.fromPrice)}`}
                                        {s.rating !== null && s.reviewCount > 0 && ` · ${s.rating.toFixed(1)}★ (${s.reviewCount})`}
                                    </span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
