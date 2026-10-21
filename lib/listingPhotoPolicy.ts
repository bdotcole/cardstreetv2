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
 * Pure module: the listing form, the bulk lister, the write paths
 * (marketplaceService.createListing, /api/listings, the collection importer)
 * and the draft publisher all read it. The database enforces the same rule
 * in supabase/migrations/20261021_listing_photos_required.sql — until it did,
 * the rule lived in the form alone, and the bulk lister published 18
 * photo-less Charizards worth ฿357k in one tap (2026-10-21). Change the two
 * together.
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

/**
 * A photo the seller took: the listing form uploads to the `listing-images`
 * bucket and stores its public URL. A catalog image or an off-site link
 * written into the column is not a photo of the item in hand, so it does not
 * count — the database applies the same test.
 */
export function isSellerPhotoUrl(url: unknown): url is string {
    return typeof url === 'string' && /\/storage\/v1\/object\/public\/listing-images\//.test(url);
}

/**
 * Does this listing carry the photos the policy asks of it? Catalog art where
 * it is allowed; otherwise the seller's own front photo, plus the back for a
 * single card (a sealed product shows one side).
 */
export function listingPhotosSatisfied(row: {
    price: number | null | undefined;
    condition: string;
    image_front_url?: string | null;
    image_back_url?: string | null;
}): boolean {
    if (catalogArtAllowed(row.price, row.condition)) return true;
    if (!isSellerPhotoUrl(row.image_front_url)) return false;
    if (row.condition === CardCondition.Sealed) return true;
    return isSellerPhotoUrl(row.image_back_url);
}

/**
 * The database raises this token in its message when a write would put a
 * photo-less listing on the market; the same token names the API error code.
 */
export const LISTING_PHOTOS_REQUIRED_CODE = 'LISTING_PHOTOS_REQUIRED';

export class ListingPhotosRequiredError extends Error {
    readonly code = LISTING_PHOTOS_REQUIRED_CODE;
    constructor(
        message = `Photos of the actual item are required at ฿${PHOTOS_REQUIRED_FROM_THB} and above, below near-mint, or for sealed products.`,
    ) {
        super(message);
        this.name = 'ListingPhotosRequiredError';
    }
}

/** True for the PostgREST error the enforcement trigger produces. */
export function isListingPhotosDbError(error: unknown): boolean {
    const message = (error as { message?: unknown } | null | undefined)?.message;
    return typeof message === 'string' && message.includes(LISTING_PHOTOS_REQUIRED_CODE);
}
