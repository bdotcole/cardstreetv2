import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { getSellerPageData } from '@/lib/sellerPageData';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import { getThumbnailUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { formatTHB } from '@/lib/currency';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
    const { username } = await params;
    const { seller, listings } = await getSellerPageData(username);
    if (!seller) return { title: 'Seller not found | CardStreet', robots: { index: false, follow: false } };

    const lang = await resolveLang();
    const name = seller.display_name || seller.username || 'Seller';
    const title = lang === 'EN' ? `${name} — Seller Shop | CardStreet` : `${name} — ร้านค้าผู้ขาย | CardStreet`;
    const description =
        lang === 'EN'
            ? `Browse ${listings.length} trading card${listings.length === 1 ? '' : 's'} for sale from ${name} on CardStreet. Verified seller, live prices, nationwide shipping in Thailand.`
            : `เลือกชมการ์ด ${listings.length} รายการจาก ${name} บน CardStreet ผู้ขายที่ยืนยันแล้ว ราคาเรียลไทม์ จัดส่งทั่วไทย`;

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates(`/seller/${username}`),
        openGraph: { title, description, type: 'website', siteName: 'CardStreet', url: `/seller/${username}` },
    };
}

export default async function DesktopSellerPage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params;
    const { seller, listings } = await getSellerPageData(username);
    if (!seller) notFound();

    const lang = await resolveLang();
    const name = seller.display_name || seller.username || 'Seller';
    const memberSince = seller.created_at ? new Date(seller.created_at).getFullYear() : null;

    return (
        <div>
            <nav className="text-sm text-slate-500">
                <Link href="/" className="hover:text-slate-300 transition-colors">{lang === 'EN' ? 'Marketplace' : 'มาร์เก็ตเพลส'}</Link>
                <span className="mx-2">›</span>
                <span className="text-slate-300">{name}</span>
            </nav>

            <header className="flex items-center gap-4 mt-6">
                <span className="w-16 h-16 rounded-full bg-slate-700 overflow-hidden shrink-0 border border-white/10 flex items-center justify-center text-xl font-black text-white">
                    {seller.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={seller.avatar_url} alt={name} className="w-full h-full object-cover" />
                    ) : (
                        name.charAt(0).toUpperCase()
                    )}
                </span>
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-black text-white">{name}</h1>
                        {seller.is_verified_shop && (
                            <span className="text-brand-cyan" title={lang === 'EN' ? 'Verified shop' : 'ร้านค้าที่ยืนยันแล้ว'}>
                                <i className="fa-solid fa-circle-check"></i>
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                        {`${listings.length} ${lang === 'EN' ? 'listings' : 'รายการ'}`}
                        {seller.review_count && seller.review_count > 0 ? ` · ★ ${Number(seller.rating).toFixed(1)} (${seller.review_count})` : ''}
                        {seller.partner_joined_at ? ` · ${lang === 'EN' ? 'Official Partner' : 'พาร์ทเนอร์ทางการ'}` : ''}
                        {memberSince ? ` · ${lang === 'EN' ? 'since' : 'ตั้งแต่'} ${memberSince}` : ''}
                    </p>
                </div>
            </header>

            {listings.length === 0 ? (
                <p className="text-slate-500 text-sm mt-10">{lang === 'EN' ? 'This seller has no active listings right now.' : 'ผู้ขายรายนี้ยังไม่มีรายการขายในขณะนี้'}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                    {listings.map((listing) => {
                        const thumb = getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl);
                        return (
                            <Link
                                key={listing.id}
                                href={`/card/${listing.card_id}`}
                                className="group bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
                            >
                                <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                                    <Image
                                        src={thumb}
                                        alt={listing.card_data.name || 'Card'}
                                        fill
                                        sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                                        loading="lazy"
                                        unoptimized={shouldSkipNextOptimization(thumb)}
                                        className={`group-hover:scale-[1.03] transition-transform duration-300 ${listing.card_data.isSealed ? 'object-contain p-3' : 'object-cover'}`}
                                    />
                                </div>
                                <div className="p-3">
                                    <h2 className="text-sm font-bold text-white truncate">{listing.card_data.name}</h2>
                                    <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                                        {listing.card_data.set}
                                    </p>
                                    <p className="text-lg font-black text-brand-cyan mt-1.5">{formatTHB(listing.price)}</p>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
