/**
 * What we tell a buyer about shipping BEFORE checkout quotes it.
 *
 * Shipping was invisible until the payment screen, which on a ฿60 card is most
 * of what the buyer ends up paying and is exactly the kind of surprise that
 * ends a first purchase. These are the numbers we may state up front.
 *
 * THE FLOOR IS ฿40, NOT ฿28. lib/flashExpress.ts BANGKOK_FALLBACK_SATANG is
 * 4000 and UPCOUNTRY_FALLBACK_SATANG is 9000; the Product JSON-LD on every card
 * page already declares 40 as "the ฿40 intra-city floor buyers start from".
 * Nothing in the system can charge 28, so advertising "from ฿28" would be a
 * price we never honour — the buyer would meet the real number at the moment
 * they are deciding whether to trust us. If Flash's contract rate genuinely
 * drops, change it HERE, in flashExpress.ts, and in the JSON-LD together.
 *
 * ONE FEE PER SELLER, not per card. app/api/orders/checkout charges shipping
 * once per seller_id (`shippingApplied` set), so a second card from the same
 * seller genuinely ships free. That is a real incentive and the cart says so.
 *
 * Transit matches the JSON-LD's deliveryTime: 1-2 days handling, 1-3 transit.
 * We quote the transit window, which is the part buyers ask about.
 */

/** The intra-city floor. Mirrors BANGKOK_FALLBACK_SATANG / the Product JSON-LD. */
export const SHIPPING_FROM_THB = 40;

/**
 * Below this price, shipping is a large enough share of the total that hiding
 * it until checkout is a bait. Above it, the line is noise on a tile.
 */
export const SHIPPING_NOTE_MAX_TILE_PRICE_THB = 200;

export function showShippingNoteOnTile(price: number | null | undefined): boolean {
    return typeof price === 'number' && Number.isFinite(price) && price > 0
        && price < SHIPPING_NOTE_MAX_TILE_PRICE_THB;
}
