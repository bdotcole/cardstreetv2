'use client';

/**
 * GA4 ecommerce events — add_to_cart, begin_checkout, purchase.
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
