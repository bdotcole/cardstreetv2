import type { MarketplaceListing } from '@/services/marketplaceService';

/**
 * Fold identical copies into one representative listing.
 *
 * createListing's `quantity` inserts N identical rows (one per physical copy,
 * so checkout's per-row status CAS still arbitrates two buyers racing for two
 * copies). Left ungrouped, the marketplace rendered N clone tiles and a buyer
 * had no way to take three packs from one seller in one go. Grouped, the grid
 * shows one tile with "x3" and the buyer picks a quantity; each unit added to
 * the cart is still its own listing id, so nothing downstream (reservation,
 * orders, fulfilment) changes.
 *
 * Siblings must match on everything a buyer sees: seller, card, condition,
 * price, grading, photos and OBO. Input rows are not mutated; representatives
 * are copies carrying `units` + `siblingIds` (self first, in input order).
 * Re-grouping an already grouped list (a paginated grid appending a page)
 * keeps the ids each representative had.
 */
export function groupSiblingListings<T extends MarketplaceListing>(listings: T[]): T[] {
    const reps = new Map<string, T>();
    const out: T[] = [];
    for (const l of listings) {
        const own = l.siblingIds?.length ? l.siblingIds : [l.id];
        const key = siblingKey(l);
        const rep = reps.get(key);
        if (rep) {
            const ids = rep.siblingIds!;
            for (const id of own) if (!ids.includes(id)) ids.push(id);
            rep.units = ids.length;
            continue;
        }
        const copy: T = { ...l, siblingIds: [...own], units: own.length };
        reps.set(key, copy);
        out.push(copy);
    }
    return out;
}

function siblingKey(l: MarketplaceListing): string {
    return [
        l.seller_id,
        l.card_id,
        l.condition,
        Number(l.price),
        l.is_graded ? `${l.grading_company ?? ''}:${l.grade ?? ''}` : '',
        l.image_front_url ?? '',
        l.image_back_url ?? '',
        l.accepts_offers ? 1 : 0,
    ].join('|');
}

/** Units of a (possibly grouped) listing; 1 for an ungrouped row. */
export function listingUnits(l: Pick<MarketplaceListing, 'units'>): number {
    return Math.max(1, l.units ?? 1);
}

/**
 * The next `count` sibling ids not already in the cart. The representative's
 * own id comes first, so an ungrouped listing behaves exactly as before.
 */
export function pickSiblingIds(
    l: Pick<MarketplaceListing, 'id' | 'siblingIds'>,
    count: number,
    inCart: ReadonlySet<string> | readonly string[] = [],
): string[] {
    const taken = inCart instanceof Set ? inCart : new Set(inCart as readonly string[]);
    const pool = l.siblingIds?.length ? l.siblingIds : [l.id];
    return pool.filter((id) => !taken.has(id)).slice(0, Math.max(0, count));
}
