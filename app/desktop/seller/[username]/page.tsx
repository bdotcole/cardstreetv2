import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSellerPageData } from '@/lib/sellerPageData';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import SellerListingTile from '@/components/desktop/SellerListingTile';
import RankChip from '@/components/rewards/rankChip';
import AvatarFrame from '@/components/rewards/AvatarFrame';
import BadgePill, { badgeLabel } from '@/components/rewards/BadgePill';
import { bandForLevel } from '@/lib/rewardTiers';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
    const { username } = await params;
    const { seller, listings } = await getSellerPageData(username);
    if (!seller) return { title: 'Seller not found | Cardstreet', robots: { index: false, follow: false } };

    const lang = await resolveLang();
    const name = seller.display_name || seller.username || 'Seller';
    const title = lang === 'EN' ? `${name} — Seller Shop | Cardstreet` : `${name} — ร้านค้าผู้ขาย | Cardstreet`;
    const description =
        lang === 'EN'
            ? `Browse ${listings.length} trading card${listings.length === 1 ? '' : 's'} for sale from ${name} on Cardstreet. Verified seller, live prices, nationwide shipping in Thailand.`
            : `เลือกชมการ์ด ${listings.length} รายการจาก ${name} บน Cardstreet ผู้ขายที่ยืนยันแล้ว ราคาเรียลไทม์ จัดส่งทั่วไทย`;

    const pathLocale = await requestPathLocale();
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates(`/seller/${username}`, pathLocale),
        openGraph: { title, description, type: 'website', siteName: 'Cardstreet', url: localizedUrl(`/seller/${username}`, pathLocale) },
    };
}

// schema.org OnlineStore — mirrors the Product JSON-LD on card pages so seller
// shops are machine-readable too (name, rating, listing count).
function buildSellerJsonLd(username: string, name: string, listingCount: number, rating: number | null, reviewCount: number | null) {
    const jsonLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'OnlineStore',
        name,
        url: `${BASE_URL}/seller/${username}`,
        parentOrganization: { '@id': `${BASE_URL}/#organization` },
        description: `${name} sells trading cards on Cardstreet, Thailand's trading card marketplace. ${listingCount} active listings.`,
    };
    if (reviewCount && reviewCount > 0 && rating != null) {
        jsonLd.aggregateRating = {
            '@type': 'AggregateRating',
            ratingValue: Number(rating).toFixed(1),
            reviewCount,
        };
    }
    return jsonLd;
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
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(
                        buildSellerJsonLd(username, name, listings.length, seller.rating ?? null, seller.review_count ?? null)
                    ),
                }}
            />
            <nav className="text-sm text-slate-500">
                <Link href="/" className="hover:text-slate-300 transition-colors">{lang === 'EN' ? 'Marketplace' : 'มาร์เก็ตเพลส'}</Link>
                <span className="mx-2">›</span>
                <span className="text-slate-300">{name}</span>
            </nav>

            <header className="flex items-center gap-4 mt-6">
                {/* Equipped Collector Pass frame wraps the avatar; no frame = plain disc. */}
                <AvatarFrame frame={seller.equipped_frame} size={64} className="text-xl font-black text-white">
                    {seller.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={seller.avatar_url} alt={name} className="w-full h-full object-cover" />
                    ) : (
                        name.charAt(0).toUpperCase()
                    )}
                </AvatarFrame>
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-2xl font-black text-white">{name}</h1>
                        {seller.is_verified_shop && (
                            <span className="text-brand-cyan" title={lang === 'EN' ? 'Verified shop' : 'ร้านค้าที่ยืนยันแล้ว'}>
                                <i className="fa-solid fa-circle-check"></i>
                            </span>
                        )}
                        {typeof seller.reward_level === 'number' && (
                            <RankChip
                                level={seller.reward_level}
                                variant="page"
                                label={lang === 'EN' ? bandForLevel(seller.reward_level).name : bandForLevel(seller.reward_level).nameTh}
                            />
                        )}
                        {(seller.displayed_badges ?? []).map((badge) => (
                            <BadgePill key={badge} badge={badge} label={badgeLabel(badge, lang)} />
                        ))}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                        {`${listings.length} ${lang === 'EN' ? 'listings' : 'รายการ'}`}
                        {seller.review_count && seller.review_count > 0 ? ` · ★ ${Number(seller.rating).toFixed(1)} (${seller.review_count})` : ''}
                        {seller.partner_joined_at ? ` · ${lang === 'EN' ? 'Official Partner' : 'พาร์ทเนอร์ทางการ'}` : ''}
                        {memberSince ? ` · ${lang === 'EN' ? 'since' : 'ตั้งแต่'} ${memberSince}` : ''}
                    </p>
                </div>
            </header>

            {/* Vacation mode: the seller paused their shop, so their listings
                are hidden. Say so, or an empty grid reads as a dead shop. */}
            {seller.shop_paused_at && (
                <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
                    <p className="font-bold text-sm text-amber-300">{lang === 'EN' ? 'This shop is paused right now' : 'ร้านค้านี้หยุดชั่วคราว'}</p>
                    <p className="text-slate-400 text-xs mt-0.5 leading-snug">{lang === 'EN' ? 'The seller is away. Their listings will be back when the shop reopens.' : 'ผู้ขายไม่อยู่ในขณะนี้ รายการขายจะกลับมาเมื่อร้านเปิดอีกครั้ง'}</p>
                </div>
            )}

            {listings.length === 0 ? (
                !seller.shop_paused_at && (
                    <p className="text-slate-500 text-sm mt-10">{lang === 'EN' ? 'This seller has no active listings right now.' : 'ผู้ขายรายนี้ยังไม่มีรายการขายในขณะนี้'}</p>
                )
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                    {listings.map((listing) => (
                        <SellerListingTile key={listing.id} listing={listing} />
                    ))}
                </div>
            )}
        </div>
    );
}
