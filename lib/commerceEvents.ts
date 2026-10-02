'use client';

/**
 * GA4 ecommerce events — add_to_cart, begin_checkout, add_shipping_info,
 * add_payment_info, purchase — plus checkout_error for the exits in between.
 *
 * WHY THIS EXISTS: the Meta Pixel has had AddToCart / InitiateCheckout /
 * Purchase since the ads push, but GA4 got none of them. The property could
 * report sessions, sign_up and the five engagement events in
 * lib/engagementEvents.ts, then nothing between "used the app" and money —
 * and with bounce rate defined as the inverse of engagement rate, a session
 * that added to cart and left still counted as a bounce. Marking add_to_cart
 * as a key event in the GA4 admin makes those sessions engaged, and gives the
 * funnel a middle. Doing that requires the event to exist first; this is it.
 *
 * WHY THESE NAMES AND SHAPES: they are GA4's reserved ecommerce events
 * (https://developers.google.com/analytics/devguides/collection/ga4/ecommerce),
 * with the reserved `items[]` parameter, so the Monetization reports populate
 * on their own and the key-event toggle is a one-click admin change rather
 * than a custom definition. Do not rename them.
 *
 * Fired at the same choke points as the Meta events, and from a shared helper
 * for the same reason lib/engagementEvents.ts gives: a new surface that reuses
 * the cart or PaymentModal code path is instrumented by construction.
 *
 * EVERYTHING FROM begin_checkout ONWARD FIRES INSIDE components/PaymentModal.tsx,
 * not in the shells. begin_checkout used to be called by the two cart buttons,
 * which left every other way into the payment form uncounted — mobile Buy Now
 * and pay-an-offer never fired it, so phones reported almost no checkouts while
 * making most of the carts. And GA4's Checkout journey report is a CLOSED
 * funnel over begin_checkout -> add_shipping_info -> add_payment_info ->
 * purchase: with the middle two never sent, steps 2-4 read zero no matter what
 * buyers did, purchases included. The modal is the one component every
 * purchase path opens, so the steps live there.
 *
 * Rides the GA tag mounted in app/layout.tsx (env-gated on
 * NEXT_PUBLIC_GA_MEASUREMENT_ID). sendGAEvent pushes onto window.dataLayer,
 * which is inert when the tag isn't loaded, so every call is safe in dev and
 * preview. Analytics must never break the action being measured: everything
 * is swallowed.
 */

import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';

/**
 * The minimal shape every cart-ish item on the site satisfies. CartItem does
 * (types.ts); so do the `any[]` items PaymentModal receives from the offer
 * pay flow. Kept structural on purpose so callers never have to map.
 */
interface CommerceItemLike {
    id?: string;
    cardId?: string;
    price?: number;
    sellerId?: string;
    card?: { name?: string; game?: string; set?: string | null } | null;
}

/** Same shell tag as lib/signupEvents.ts / lib/engagementEvents.ts. */
function surface(): 'native_app' | 'web' {
    try {
        return Capacitor.isNativePlatform() ? 'native_app' : 'web';
    } catch {
        return 'web';
    }
}

/** GA4 reserved item shape: the catalog card id is the item_id (so one card sold by several sellers aggregates), the seller rides as item_brand. */
function toGaItems(items: CommerceItemLike[], multiplier: number) {
    return items.map((i) => ({
        item_id: i.cardId || i.id || '',
        item_name: i.card?.name || i.cardId || i.id || '',
        item_category: i.card?.game || '',
        item_category2: i.card?.set || '',
        item_brand: i.sellerId || '',
        price: round2((i.price ?? 0) * multiplier),
        quantity: 1,
    }));
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function send(name: string, params: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    try {
        sendGAEvent('event', name, { ...params, surface: surface() });
    } catch {
        // GA not loaded (env var unset) — nothing to report to.
    }
}

/**
 * Value is reported in the user's display currency, matching the Meta
 * AddToCart convention at the same call sites. `exchangeRate` is the
 * THB-per-display-unit factor the shell already holds; pass 1 for THB.
 */
export function trackAddToCart(items: CommerceItemLike[], currency: string, exchangeRate: number): void {
    if (items.length === 0) return;
    const mult = currency === 'THB' ? 1 : exchangeRate;
    send('add_to_cart', {
        currency,
        value: round2(items.reduce((s, i) => s + (i.price ?? 0), 0) * mult),
        items: toGaItems(items, mult),
    });
}

export function trackBeginCheckout(items: CommerceItemLike[], currency: string, exchangeRate: number): void {
    if (items.length === 0) return;
    const mult = currency === 'THB' ? 1 : exchangeRate;
    send('begin_checkout', {
        currency,
        value: round2(items.reduce((s, i) => s + (i.price ?? 0), 0) * mult),
        items: toGaItems(items, mult),
    });
}

/**
 * Step 2 of the GA4 checkout funnel. There is no shipping form inside the
 * payment modal — the address gate runs before it opens — so the honest moment
 * is when the server quotes shipping to the buyer's saved address and the
 * shipping-inclusive total is on screen. A buyer who reaches begin_checkout but
 * not this step hit a failed quote, which is exactly the drop worth seeing.
 * THB, like purchase: from here on the figures are the server's, not the cart's.
 */
export function trackAddShippingInfo(args: {
    items: CommerceItemLike[];
    valueThb: number;
    shippingThb: number;
}): void {
    if (args.items.length === 0) return;
    send('add_shipping_info', {
        currency: 'THB',
        value: round2(args.valueThb),
        shipping: round2(args.shippingThb),
        shipping_tier: 'Flash Express',
        items: toGaItems(args.items, 1),
    });
}

/**
 * Step 3: the buyer pressed Pay and Stripe accepted what they entered.
 * `paymentType` is the tab selected in the PaymentElement ('promptpay' or
 * 'card'), or 'unknown' when Stripe never reported a selection.
 */
export function trackAddPaymentInfo(args: {
    items: CommerceItemLike[];
    valueThb: number;
    paymentType: string;
}): void {
    if (args.items.length === 0) return;
    send('add_payment_info', {
        currency: 'THB',
        value: round2(args.valueThb),
        payment_type: args.paymentType,
        items: toGaItems(args.items, 1),
    });
}

/**
 * The payment form finished rendering: the method tabs and the Pay button are
 * on screen. Sits between add_shipping_info and add_payment_info. The first
 * three days of the full funnel read 12 forms opened, 13 shipping quotes shown
 * and nothing after — no Pay press, valid or invalid, and no checkout_error —
 * which cannot tell a form that never appeared on the device from a buyer who
 * looked at it and left. This event is the difference. Custom event with no
 * parameters, so it is countable by name with nothing to register in GA4.
 */
export function trackCheckoutFormReady(): void {
    send('checkout_form_ready', {});
}

/**
 * Where a checkout stopped, and why. A rejected /api/orders/checkout or
 * /api/checkout call writes no row anywhere, so before this a buyer who was
 * refused at the payment form was indistinguishable from one who changed their
 * mind. Codes only, never the message shown to the buyer: GA4 truncates
 * parameter values at 100 characters and free text does not aggregate.
 *
 * Custom event, custom parameters — register `checkout_stage` and `error_code`
 * as event-scoped custom dimensions in the GA4 admin or they are collected but
 * not reportable.
 */
export type CheckoutStage =
    | 'estimate'
    | 'seller_not_ready'
    | 'stripe_load'
    | 'payment_details'
    | 'order'
    | 'payment_intent'
    | 'confirm';

export function trackCheckoutError(stage: CheckoutStage, code: string): void {
    send('checkout_error', {
        checkout_stage: stage,
        error_code: String(code || 'unknown').slice(0, 100),
    });
}

/**
 * Reports the real charge in THB, never the display currency, so GA revenue
 * matches Stripe. `paymentStatus` is a custom parameter: unlike the Meta
 * Purchase event (settled card payments only), this fires on PromptPay's
 * 'processing' too — PromptPay leads at every amount here, so excluding it
 * would drop most real purchases from the funnel. A processing PromptPay
 * intent is post-authorization and almost always settles; the parameter is
 * there so an analysis can separate the two if it ever matters.
 */
export function trackPurchase(args: {
    transactionId: string;
    valueThb: number;
    items: CommerceItemLike[];
    paymentMethod: string;
    paymentStatus: 'succeeded' | 'processing';
}): void {
    send('purchase', {
        transaction_id: args.transactionId,
        currency: 'THB',
        value: round2(args.valueThb),
        items: toGaItems(args.items, 1),
        payment_method: args.paymentMethod,
        payment_status: args.paymentStatus,
    });
}
