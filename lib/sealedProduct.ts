import { Card, Rarity } from '@/types';
import type { SealedProduct } from '@/services/pokemonService';
import { EXCHANGE_RATES } from '@/constants';
import { displaySetName } from '@/lib/cardMapper';

// Bilingual display labels for sealed_products.product_type. Shared by the
// catalog detail view, the vault, and the sell flows.
export const PRODUCT_TYPE_LABELS: Record<string, { en: string; th: string }> = {
    booster_box: { en: 'Booster Box', th: 'กล่องบูสเตอร์' },
    etb: { en: 'Elite Trainer Box', th: 'กล่อง Elite Trainer' },
    booster_pack: { en: 'Booster Pack', th: 'ซองบูสเตอร์' },
    bundle: { en: 'Booster Bundle', th: 'ชุดบูสเตอร์' },
    collection: { en: 'Collection', th: 'กล่องคอลเลกชัน' },
    other: { en: 'Sealed', th: 'สินค้าซีล' },
};

export function productTypeLabel(productType: string | null | undefined, isThai: boolean): string {
    const entry = PRODUCT_TYPE_LABELS[productType || 'other'] || PRODUCT_TYPE_LABELS.other;
    return isThai ? entry.th : entry.en;
}

/**
 * Represent a sealed product as a Card so it can ride the existing
 * card_data-snapshot pipeline: collection_items, listings, cart, checkout,
 * portfolio valuation, and every render surface that consumes card_data.
 *
 * `isSealed: true` is the discriminator downstream code keys off (condition
 * defaults, ListingForm sealed mode, parcel weight). `set` carries the
 * product-type label since sealed items have no set/number/rarity of their own.
 */
/** Raw sealed_products row, as selected by /api/sealed and the desktop card page. */
export interface SealedProductRow {
    id: string;
    game: string;
    language: string;
    set_id: string | null;
    name: string;
    product_type: string | null;
    image_url: string | null;
    pricecharting_id: string | null;
    loose_price: number | null;
    cib_price: number | null;
    new_price: number | null;
    currency: string | null;
    last_updated?: string | null;
}

const USD_TO_THB = 1 / (EXCHANGE_RATES['USD'] || 0.028);

// PriceCharting rows are stored in USD and converted to the THB base; Thai
// retail-SRP rows are stored THB-native (currency='THB') and pass through.
const toThb = (val: number | null | undefined, currency: string) => {
    if (typeof val !== 'number' || val <= 0) return null;
    return currency === 'THB' ? Math.round(val) : Math.round(val * USD_TO_THB);
};

/** DB row -> API shape (THB base prices). Single source for /api/sealed and SSR.
 *  `setNameRaw` is the pokemon_sets.name for row.set_id (set_id is deliberately
 *  not a FK, so callers resolve it with a second query and pass it in). */
export function mapSealedRowToProduct(row: SealedProductRow, setNameRaw?: string | null): SealedProduct {
    const cur = row.currency || 'USD';
    const sealed = toThb(row.new_price, cur);
    const cib = toThb(row.cib_price, cur);
    const loose = toThb(row.loose_price, cur);
    return {
        id: row.id,
        name: row.name,
        productType: row.product_type,
        setId: row.set_id,
        setName: setNameRaw ? displaySetName(row.game, row.language, row.set_id, setNameRaw) : null,
        game: row.game,
        language: row.language,
        imageUrl: row.image_url,
        // Headline = factory-sealed, falling back to CIB then loose.
        price: sealed ?? cib ?? loose,
        prices: { sealed, cib, loose },
        currency: 'THB',
        // Thai rows: JP-twin-derived estimate (pricecharting_id = the JP box)
        // or plain retail SRP (no JP twin). Everything else: PriceCharting market.
        priceType: row.language === 'th' ? (row.pricecharting_id ? 'estimate' : 'srp') : 'market',
        lastUpdated: row.last_updated ?? undefined,
    };
}

export function sealedProductToCard(p: SealedProduct): Card {
    const imageUrl = p.imageUrl || '';
    return {
        id: p.id,
        name: p.name,
        thaiName: '',
        // The set line under the product name. Real set name when the product
        // resolves to one; the product-type label otherwise (cross-set bundles).
        set: p.setName || productTypeLabel(p.productType, false),
        number: '—',
        // Renders as the badge text where rarity is shown; not a real card rarity.
        rarity: Rarity.Sealed,
        imageUrl,
        images: imageUrl ? { small: imageUrl, large: imageUrl } : undefined,
        // THB base, same convention as card.marketPrice (multiply by display rate).
        marketPrice: p.price ?? 0,
        priceHistory: [],
        language: p.language,
        game: p.game || 'pokemon',
        isSealed: true,
        productType: p.productType,
    };
}
