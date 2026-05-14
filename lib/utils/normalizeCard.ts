import { Card, Rarity } from '@/types';

/**
 * Coerces a raw `card_data` JSONB blob into a fully-populated Card.
 *
 * Why this exists: `card_data` is stored as JSONB and historically some rows
 * were written with missing required fields (set, number, marketPrice, ...).
 * Render code does things like `card.set.toLowerCase()` and
 * `card.marketPrice.toLocaleString()` on every render of the Vault, so a
 * single bad row crashes the React tree for the whole user.
 *
 * Normalize once at the data layer instead of guarding every render site.
 */
export function normalizeCard(raw: any, fallbackId?: string): Card {
    const r = raw ?? {};
    return {
        id: typeof r.id === 'string' && r.id ? r.id : (fallbackId ?? ''),
        name: typeof r.name === 'string' ? r.name : '',
        thaiName: typeof r.thaiName === 'string' ? r.thaiName : '',
        set: typeof r.set === 'string' ? r.set : '—',
        number: typeof r.number === 'string' ? r.number : (r.number != null ? String(r.number) : '—'),
        rarity: (r.rarity as Rarity) ?? Rarity.C,
        imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : '',
        images: r.images,
        marketPrice: typeof r.marketPrice === 'number' && Number.isFinite(r.marketPrice) ? r.marketPrice : 0,
        prices: r.prices,
        tcgplayerUrl: r.tcgplayerUrl,
        change7d: typeof r.change7d === 'number' ? r.change7d : undefined,
        priceHistory: Array.isArray(r.priceHistory) ? r.priceHistory : [],
        language: typeof r.language === 'string' ? r.language : undefined,
    };
}
