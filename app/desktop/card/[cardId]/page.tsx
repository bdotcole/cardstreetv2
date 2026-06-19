import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import DesktopCardDetail from '@/components/desktop/DesktopCardDetail';
import { getCardPageData } from '@/lib/desktopCardData';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import { getOptimizedImageUrl } from '@/lib/imageUtils';
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
    return [card.set, card.number ? `#${card.number}` : '', card.rarity].filter(Boolean).join(' ');
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

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates(`/card/${cardId}`),
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: `/card/${cardId}`,
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
    };
}

// schema.org Product — eligible for rich results and quotable by AI answer
// engines. Offers come from active listings (an AggregateOffer) or fall back to
// the catalog market value.
function buildProductJsonLd(card: Card, listings: MarketplaceListing[]) {
    const image = getOptimizedImageUrl(card.images?.large || card.imageUrl || card.images?.small, 600, 85);
    const jsonLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: card.name,
        category: 'Trading Card',
        ...(image ? { image: [image] } : {}),
        ...(card.set ? { brand: { '@type': 'Brand', name: card.set } } : {}),
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
        };
    } else if (card.marketPrice > 0) {
        jsonLd.offers = {
            '@type': 'Offer',
            priceCurrency: 'THB',
            price: Math.round(card.marketPrice),
            availability: 'https://schema.org/OutOfStock',
        };
    }
    return jsonLd;
}

export default async function DesktopCardPage({ params }: { params: Promise<{ cardId: string }> }) {
    const { cardId } = await params;
    const { card, listings } = await getCardPageData(cardId);
    if (!card) notFound();

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildProductJsonLd(card, listings)) }}
            />
            <DesktopCardDetail cardId={cardId} initialCard={card} initialListings={listings} />
        </>
    );
}
