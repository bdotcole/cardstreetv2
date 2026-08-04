import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import DesktopCardDetail from '@/components/desktop/DesktopCardDetail';
import { getCardPageData } from '@/lib/desktopCardData';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
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
    return [card.set, number, card.rarity].filter(Boolean).join(' ');
}

function lowestPrice(card: Card, listings: MarketplaceListing[]): number {
    if (listings.length) return Math.min(...listings.map((l) => l.price));
    return card.marketPrice || 0;
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
    const priceTxt = low > 0 ? `฿${Math.round(low).toLocaleString()}` : '';
    const title = `${card.name}${line ? ` — ${line}` : ''} | CardStreet`;
    const description =
        lang === 'EN'
            ? `Buy ${card.name}${card.set ? ` from ${card.set}` : ''} on CardStreet${priceTxt ? ` starting at ${priceTxt}` : ''}. Live market prices, verified sellers, and nationwide shipping in Thailand.`
            : `ซื้อ ${card.name}${card.set ? ` ชุด ${card.set}` : ''} บน CardStreet${priceTxt ? ` เริ่มต้น ${priceTxt}` : ''} ราคาตลาดเรียลไทม์ ผู้ขายที่ยืนยันแล้ว จัดส่งทั่วไทย`;

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
function buildProductJsonLd(card: Card, listings: MarketplaceListing[]): Record<string, unknown> | null {
    if (!listings.length && !(card.marketPrice > 0)) return null;

    const image = getOptimizedImageUrl(card.images?.large || card.imageUrl || card.images?.small, 600, 85);
    const line = setLine(card);
    const jsonLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: card.name,
        sku: card.id,
        url: `${BASE_URL}/card/${card.id}`,
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

    const productJsonLd = buildProductJsonLd(card, listings);

    return (
        <>
            {productJsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
                />
            )}
            <DesktopCardDetail cardId={cardId} initialCard={card} initialListings={listings} setId={setId} />
        </>
    );
}
