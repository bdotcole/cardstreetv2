import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPublicWishlist } from '@/lib/wishlistShareData';
import { isGiftSeason } from '@/lib/wishlistShare';
import { BASE_URL, DEFAULT_OG_IMAGE, localePrefix, localizedUrl, requestPathLocale } from '@/lib/i18nRouting';
import { getOptimizedImageUrl } from '@/lib/imageUtils';
import PublicWishlistView, { ownerName } from '@/components/wishlist/PublicWishlistView';

// A shared wishlist, cardstreet.app/wishlist/<token>. Reached through the
// middleware rewrite for every client (phones, desktops, crawlers and the
// native app alike, see WISHLIST_SHARE_RE), so one document serves the link
// wherever it is opened. Private content shared by link: noindex, and no
// hreflang on a noindexed page.

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
    const { token } = await params;
    const data = await getPublicWishlist(token);
    if (!data) return { title: 'Wishlist not found | Cardstreet', robots: { index: false, follow: false } };

    const lang = await resolveLang();
    const name = ownerName(data.owner, lang);
    const n = data.totalCards;
    const title = lang === 'EN' ? `${name}'s wishlist | Cardstreet` : `รายการที่อยากได้ของ ${name} | Cardstreet`;
    const description =
        lang === 'EN'
            ? `${n} card${n === 1 ? '' : 's'} ${name} is hoping for. See which ones are available to buy right now on Cardstreet, with shipping anywhere in Thailand.`
            : `การ์ด ${n} ใบที่ ${name} อยากได้ ดูว่าใบไหนมีขายอยู่ตอนนี้บน Cardstreet จัดส่งทั่วไทย`;

    // The first card's art is the share preview on LINE and Facebook: a card
    // the recipient recognizes beats the generic brand image at making the
    // link worth a tap.
    const first = data.cards[0]?.card;
    const artSource = first ? first.images?.large || first.imageUrl || first.images?.small : '';
    const art = artSource ? getOptimizedImageUrl(artSource, 600, 85) : '';

    const pathLocale = await requestPathLocale();
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        // follow stays on so the card pages it links keep this crawl path.
        robots: { index: false, follow: true },
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'Cardstreet',
            url: localizedUrl(`/wishlist/${encodeURIComponent(token)}`, pathLocale),
            images: art ? [{ url: art }] : DEFAULT_OG_IMAGE,
        },
    };
}

export default async function SharedWishlistPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const data = await getPublicWishlist(token);
    if (!data) notFound();

    const lang = await resolveLang();
    const pathPrefix = localePrefix(await requestPathLocale());

    // The owner opening their own link sees a note that this is the public view.
    let isOwner = false;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        isOwner = !!user && user.id === data.owner.id;
    } catch {
        isOwner = false;
    }

    return <PublicWishlistView data={data} lang={lang} pathPrefix={pathPrefix} isOwner={isOwner} giftSeason={isGiftSeason()} />;
}
