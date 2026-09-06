/**
 * When may a listing use the catalog image instead of the seller's own photos?
 *
 * Two photos per card is the right rule for a 2,000-baht chase card: the buyer
 * is paying for condition, and only a real photo shows it. It is the wrong rule
 * for a 40-baht common, where the photography costs more effort than the card
 * is worth — and that is most of a collection. A seller with 60 bulk cards to
 * move faced 120 photographs, which is why they moved none of them.
 *
 * The threshold is a judgement, not a derivation: high enough to cover the
 * long tail of commons and playables, low enough that anything a buyer would
 * think twice about still needs a real photo. Raise it only with evidence from
 * dispute rates.
 *
 * Condition is the second gate. Catalog art shows a mint card, so it can only
 * stand in for a card the seller is describing as near-mint — using it for a
 * played card would be a picture that contradicts the listing.
 *
 * Pure module: the listing form, the bulk lister and the server all read it.
 */

import { CardCondition } from '@/types';

/** At or below this asking price, catalog art may stand in for photos. */
export const CATALOG_ART_MAX_PRICE_THB = 300;

export function catalogArtAllowed(price: number | null | undefined, condition: string): boolean {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
    if (price > CATALOG_ART_MAX_PRICE_THB) return false;
    // Sealed products are identical by definition — the packshot IS the item.
    if (condition === CardCondition.Sealed) return true;
    return condition === CardCondition.NM;
}
