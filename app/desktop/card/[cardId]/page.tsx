import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import DesktopCardDetail from '@/components/desktop/DesktopCardDetail';
import { getCardPageData, getSetSiblings } from '@/lib/desktopCardData';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import { getOptimizedImageUrl } from '@/lib/imageUtils';
import { getGame } from '@/lib/games';
import type { Card } from '@/types';
import type { MarketplaceListing } from '@/services/marketplaceService';

// Locale is resolved by middleware and passed via the x-cs-lang header (Thai is
// canonical). Reading headers() also opts this route into per-request dynamic
// rendering, so each locale gets its own correct HTML rather than a shared
// cached copy.
async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

function setLine(card: Card): string {
    // Sealed products carry a placeholder collector number ('—'); printing it
    // put a bare "#—" in the <title> and OG tags of every sealed page.
    const number = card.number && !card.isSealed ? `#${card.number}` : '';
    return [setName(card), number, card.rarity].filter(Boolean).join(' ');
}

/** Some catalog rows carry trailing whitespace in the set name. */
function setName(card: Card): string {
    return (card.set || '').trim();
}

function lowestPrice(card: Card, listings: MarketplaceListing[]): number {
    if (listings.length) return Math.min(...listings.map((l) => l.price));
    return card.marketPrice || 0;
}

function thb(amount: number): string {
    return `฿${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * One or two sentences of real prose for the card page, which otherwise ships
 * a heading and a price panel with no indexable sentence on it.
 *
 * Deliberately built from THIS card's own facts (name, set, number, rarity,
 * market price, live listing count and floor) rather than a fixed sentence
 * templated across ~86k pages — identical boilerplate at that scale reads as
 * thin content, which both Bing and Semrush already flag on this domain.
 *
 * Prices are a server-render snapshot; the panel below stays live.
 */
function buildCardSummary(card: Card, listings: MarketplaceListing[], lang: 'EN' | 'TH'): string {
    const market = card.marketPrice && card.marketPrice > 0 ? thb(card.marketPrice) : null;
    const count = listings.length;
    const floor = count ? thb(Math.min(...listings.map((l) => l.price))) : null;

    const set = setName(card);

    if (lang === 'EN') {
        // Rarity trails the noun rather than modifying it ("a AR card" vs "an AR
        // card") — rarity codes are letter salad and no a/an rule handles them all.
        const what = [
            card.name,
            card.isSealed ? ' is a sealed product' : ' is a trading card',
            set ? ` from ${set}` : '',
            !card.isSealed && card.number ? ` (#${card.number})` : '',
            !card.isSealed && card.rarity ? `, rarity ${card.rarity}` : '',
            '.',
        ].join('');

        let state: string;
        if (market && count) {
            state = ` The current market price is ${market}, and ${count} ${count === 1 ? 'listing starts' : 'listings start'} at ${floor} from verified sellers with nationwide delivery in Thailand.`;
        } else if (market) {
            state = ` The current market price is ${market}. No one has it listed right now — add it to your wishlist to be alerted when a seller does.`;
        } else if (count) {
            state = ` ${count} ${count === 1 ? 'listing starts' : 'listings start'} at ${floor} from verified sellers with nationwide delivery in Thailand.`;
        } else {
            state = ' Track its market price and get alerted when a seller lists one on CardStreet.';
        }
        return what + state;
    }

    const what = [
        card.name,
        ' เป็น',
        card.isSealed ? 'สินค้าซีล' : 'การ์ด',
        !card.isSealed && card.rarity ? `ระดับ ${card.rarity}` : '',
        set ? ` จากชุด ${set}` : '',
        !card.isSealed && card.number ? ` หมายเลข ${card.number}` : '',
    ].join('');

    let state: string;
    if (market && count) {
        state = ` ราคาตลาดล่าสุดอยู่ที่ ${market} ขณะนี้มี ${count} รายการขายบน CardStreet เริ่มต้นที่ ${floor} จากผู้ขายที่ยืนยันตัวตนแล้ว จัดส่งทั่วไทย`;
    } else if (market) {
        state = ` ราคาตลาดล่าสุดอยู่ที่ ${market} ขณะนี้ยังไม่มีผู้ขายลงการ์ดใบนี้ กดถูกใจไว้เพื่อรับแจ้งเตือนเมื่อมีรายการขายใหม่`;
    } else if (count) {
        state = ` ขณะนี้มี ${count} รายการขายบน CardStreet เริ่มต้นที่ ${floor} จากผู้ขายที่ยืนยันตัวตนแล้ว จัดส่งทั่วไทย`;
    } else {
        state = ' เช็คราคาตลาดและรับแจ้งเตือนเมื่อมีผู้ขายลงการ์ดใบนี้ได้บน CardStreet';
    }
    return what + state;
}

export async function generateMetadata({ params }: { params: Promise<{ cardId: string }> }): Promise<Metadata> {
    const { cardId } = await params;
    const { card, listings } = await getCardPageData(cardId);
    if (!card) {
        return { title: 'Card not found | CardStreet', robots: { index: false, follow: false } };
    }

    const lang = await resolveLang();
    const line = setLine(card);
    const low = lowestPrice(card, listings);
    const priceTxt = low > 0 ? thb(low) : '';
    // Thai leads with ราคา: price-check is the intent that actually converts here
    // ("เช็คราคาการ์ดโปเกม่อน" is the site's best-ranking query), and branching by
    // locale also stops the bare and /en variants emitting one identical title.
    const title =
        lang === 'EN'
            ? `${card.name}${line ? ` — ${line}` : ''} | CardStreet`
            : `ราคา ${card.name}${line ? ` — ${line}` : ''} | CardStreet`;
    const description =
        lang === 'EN'
            ? `Buy ${card.name}${setName(card) ? ` from ${setName(card)}` : ''} on CardStreet${priceTxt ? ` starting at ${priceTxt}` : ''}. Live market prices, verified sellers, and nationwide shipping in Thailand.`
            : `ซื้อ ${card.name}${setName(card) ? ` ชุด ${setName(card)}` : ''} บน CardStreet${priceTxt ? ` เริ่มต้น ${priceTxt}` : ''} ราคาตลาดเรียลไทม์ ผู้ขายที่ยืนยันแล้ว จัดส่งทั่วไทย`;

    const ogImage = getOptimizedImageUrl(card.images?.large || card.imageUrl || card.images?.small, 600, 85);

    const pathLocale = await requestPathLocale();
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates(`/card/${cardId}`, pathLocale),
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl(`/card/${cardId}`, pathLocale),
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
    };
}

// Merchant-listing fields GSC flags as missing when absent from offers.
// Shipping is Flash Express within Thailand, quoted live per order at checkout
// (buyers pay the real route rate — intra-Bangkok ~฿28, upcountry ~฿90+), so
// there is no fixed price to bill. Google's merchant spec still requires a
// concrete shippingRate.value + deliveryTime, so we declare Flash's domestic
// base rate (the ฿40 intra-city floor buyers start from) and its real handling
// (seller dispatch, 1-2 days) / transit (1-3 days nationwide) windows. These
// are the structured-data floor for rich results, not the amount charged.
// CardStreet has no change-of-mind returns; damaged / not-as-described cases
// are mediated refunds under buyer protection, which is dispute resolution,
// not a merchant return policy — so returns are declared not permitted.
const OFFER_SHIPPING_DETAILS = {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: 40, currency: 'THB' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'TH' },
    deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
        transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' },
    },
};
const OFFER_RETURN_POLICY = {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'TH',
    returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
};

// schema.org Product — eligible for rich results and quotable by AI answer
// engines. Offers come from active listings (an AggregateOffer) or fall back to
// the catalog market value. Returns null when there is no price signal at all:
// a Product with no offers/review/aggregateRating is a critical GSC error, so
// those pages ship no Product block rather than a broken one.
function buildProductJsonLd(card: Card, listings: MarketplaceListing[], pathLocale: 'th' | 'en'): Record<string, unknown> | null {
    if (!listings.length && !(card.marketPrice > 0)) return null;

    const image = getOptimizedImageUrl(card.images?.large || card.imageUrl || card.images?.small, 600, 85);
    const line = setLine(card);
    const jsonLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: card.name,
        sku: card.id,
        // Follows the URL variant being served so the /en page's Product node
        // does not point at the Thai canonical.
        url: localizedUrl(`/card/${card.id}`, pathLocale),
        description: `${card.name} trading card${line ? ` (${line})` : ''}. Buy and sell on CardStreet with live market prices, verified sellers, and nationwide delivery in Thailand.`,
        category: 'Trading Card',
        ...(image ? { image: [image] } : {}),
        brand: { '@type': 'Brand', name: getGame(card.game).name },
    };
    if (listings.length) {
        const prices = listings.map((l) => l.price);
        jsonLd.offers = {
            '@type': 'AggregateOffer',
            priceCurrency: 'THB',
            lowPrice: Math.min(...prices),
            highPrice: Math.max(...prices),
            offerCount: listings.length,
            availability: 'https://schema.org/InStock',
            shippingDetails: OFFER_SHIPPING_DETAILS,
            hasMerchantReturnPolicy: OFFER_RETURN_POLICY,
        };
    } else {
        jsonLd.offers = {
            '@type': 'Offer',
            priceCurrency: 'THB',
            price: Math.round(card.marketPrice),
            availability: 'https://schema.org/OutOfStock',
            shippingDetails: OFFER_SHIPPING_DETAILS,
            hasMerchantReturnPolicy: OFFER_RETURN_POLICY,
        };
    }
    return jsonLd;
}

export default async function DesktopCardPage({ params }: { params: Promise<{ cardId: string }> }) {
    const { cardId } = await params;
    const { card, listings, setId } = await getCardPageData(cardId);
    if (!card) notFound();

    const pathLocale = await requestPathLocale();
    const productJsonLd = buildProductJsonLd(card, listings, pathLocale);
    const summary = buildCardSummary(card, listings, await resolveLang());
    // Server-rendered so the sibling links are in the initial HTML and crawlable.
    // Sealed products have no set_id and get an empty list, which renders nothing.
    const siblings = await getSetSiblings(setId, cardId);

    return (
        <>
            {productJsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
                />
            )}
            <DesktopCardDetail
                cardId={cardId}
                initialCard={card}
                initialListings={listings}
                setId={setId}
                summary={summary}
                siblings={siblings}
                pathPrefix={localePrefix(pathLocale)}
            />
        </>
    );
}
