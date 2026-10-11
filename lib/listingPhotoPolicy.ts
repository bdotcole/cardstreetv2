/**
 * When may a listing use the catalog image instead of the seller's own photos?
 *
 * Two photos per card is the right rule for a 2,000-baht chase card: the buyer
 * is paying for condition, and only a real photo shows it. It is the wrong rule
 * for a 40-baht common, where the photography costs more effort than the card
 * is worth — and that is most of a collection. A seller with 60 bulk cards to
 * move faced 120 photographs, which is why they moved none of them.
 *
 * The threshold is a judgement, not a derivation: it covers the long tail of
 * commons and cheap playables and nothing a buyer would think twice about.
 * It started at ฿300 and was cut to ฿100 on 2026-09-21 — the founder's call:
 * above pocket money, buyers should see the actual card. Raise it only with
 * evidence from dispute rates.
 *
 * Condition is the second gate. Catalog art shows a mint card, so it can only
 * stand in for a card the seller is describing as near-mint — using it for a
 * played card would be a picture that contradicts the listing.
 *
 * Sealed products never qualify. A packshot proves nothing about the box in
 * the seller's hands (reseals, dents, missing shrink, region), and sealed is
 * where the money is — a 20-copy booster-box listing on a stock render was
 * exactly the case that got the loophole closed.
 *
 * Pure module: the listing form and the bulk lister both read it.
 */

import { CardCondition } from '@/types';

/**
 * From this asking price upward, real photos are required. Strictly below it,
 * catalog art may stand in for a near-mint single.
 */
export const PHOTOS_REQUIRED_FROM_THB = 100;

export function catalogArtAllowed(price: number | null | undefined, condition: string): boolean {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
    if (price >= PHOTOS_REQUIRED_FROM_THB) return false;
    if (condition === CardCondition.Sealed) return false;
    return condition === CardCondition.NM;
}
