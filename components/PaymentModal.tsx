'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { Stripe, StripeElementsOptions } from '@stripe/stripe-js';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { trackMetaEvent } from '@/lib/metaEvents';
import { CURRENCY_SYMBOLS } from '@/constants';

// Publishable key, region-aware to match the dual-platform server setup.
// The server reads STRIPE_SECRET_KEY_TH for the Thailand platform; its client
// counterpart is NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TH. We prefer the TH key
// and fall back to the legacy un-suffixed var so either Vercel naming works.
//
// NEXT_PUBLIC_* values are inlined at build time and must be referenced as
// static `process.env.X` member accesses for Next to inline them — don't
// rewrite this as a dynamic lookup. Trim defensively: a trailing space/newline
// pasted into Vercel makes loadStripe() reject the key and renders a blank,
// dead card field.
const PUBLISHABLE_KEY = (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TH ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ''
).trim();

// Stripe.js instances are cached per connected account. A Thailand direct
// charge requires the card to be tokenized in the SELLER's account context
// (`stripeAccount`) — /api/checkout creates the PaymentIntent on that account,
// and a platform-scoped PaymentMethod would be rejected with "No such
// payment_method." The legacy US platform path loads without an account.
const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(stripeAccount?: string | null): ReturnType<typeof loadStripe> | null {
    if (!PUBLISHABLE_KEY) return null;
    const cacheKey = stripeAccount || '__platform__';
    let promise = stripePromiseCache.get(cacheKey);
    if (!promise) {
        promise = loadStripe(PUBLISHABLE_KEY, stripeAccount ? { stripeAccount } : undefined);
        // Evict a failed load. loadStripe rejects with "Failed to load
        // Stripe.js" whenever js.stripe.com can't be fetched — an ad/tracker
        // blocker, a captive-portal wifi, a flaky mobile connection. Keeping
        // the rejected promise in the cache would replay that same failure for
        // the rest of the session, so the buyer could never retry the purchase
        // without a full page reload. The catch also marks this promise as
        // handled; consumers attach their own handlers independently.
        promise.catch(() => { stripePromiseCache.delete(cacheKey); });
        stripePromiseCache.set(cacheKey, promise);
    }
    return promise;
}

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Cart subtotal in THB — the currency all listing prices are stored in. */
    amount: number;
    shippingFee?: number;
    /** Display currency only. The charge itself is always THB on the TH platform. */
    currency: string;
    /** THB → display-currency multiplier (EXCHANGE_RATES[currency]). Unused when currency is THB. */
    exchangeRate?: number;
    items: any[];
    apiEndpoint?: string; // New prop
    extraData?: any; // New prop
    /**
     * OBO: id of an accepted offer being paid. When set, it's forwarded to
     * /api/orders/checkout, which reads the authoritative (discounted) price
     * from the offer server-side. The client never sends the offer price.
     */
    acceptedOfferId?: string;
    onPaymentSuccess: (details: { paymentMethod: string, paymentId: string, transferGroup?: string }) => void;
    onPaymentFailed: (error: string) => void;
}

// Inner form — must be inside <Elements> to use useStripe / useElements.
//
// Uses Stripe's *deferred* PaymentElement flow so the modal can offer every
// method the seller's connected account supports (card + PromptPay on TH)
// without us hardcoding a card field:
//   1. elements.submit()        — validate + collect.
//   2. /api/orders/checkout     — create pending orders, reserve inventory,
//                                 get the transfer_group (zombie-payment guard).
//   3. /api/checkout            — create an unconfirmed PaymentIntent on the
//                                 seller's connected account, return client_secret.
//   4. stripe.confirmPayment()  — confirm. Card confirms inline; PromptPay shows
//                                 a QR and settles async (fulfilled by the webhook
//                                 on payment_intent.succeeded).
const PaymentElementForm: React.FC<{
    /** Order total in THB — the amount actually charged. */
    amountThb: number;
    /** Renders a THB amount in the user's display currency. */
    formatAmount: (thb: number) => string;
    items: any[];
    apiEndpoint?: string;
    extraData?: any;
    acceptedOfferId?: string;
    onPaymentSuccess: (details: { paymentMethod: string, paymentId: string, transferGroup?: string }) => void;
    onPaymentFailed: (error: string) => void;
    onTotalChanged?: (newTotal: number) => void;
    /** Fired once orders are created + inventory reserved (before the charge),
     *  so the modal can release the reservation if the buyer then abandons. */
    onOrderReserved?: (transferGroup: string) => void;
    /** Collector Pass voucher to apply (validated + clamped server-side). */
    voucherId?: string | null;
}> = ({ amountThb, formatAmount, items, apiEndpoint = '/api/checkout', extraData = {}, acceptedOfferId, onPaymentSuccess, onPaymentFailed, onTotalChanged, onOrderReserved, voucherId }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    // Set after a card is declined. Only used for the inline explanation now —
    // PromptPay already leads at every amount (see paymentMethodOrder), so the
    // ordering does not need to change on a decline; the buyer needs to be TOLD
    // why, not silently re-ordered.
    const [cardDeclined, setCardDeclined] = useState(false);

    // PromptPay first. Always, at every amount.
    //
    // It is a bank push: no issuer authorisation step, so no decline path, no
    // card limit, no cross-border interchange. Cards have all three, and that is
    // where the money has actually been lost — 5 of 8 payments failed over
    // Aug 9-23 (฿39,055), three `insufficient_funds` and two `try_again_later`.
    //
    // This was originally gated above ฿1,500 on the theory that small orders are
    // safe on card. That theory protects the wrong thing: the ceiling that
    // matters is the one a Thai bank sets by DEFAULT on online/international
    // spend, which the cardholder has to raise in their banking app and mostly
    // has not — and a first-time buyer who bounces on a ฿300 order is lost just
    // as completely as one who bounces on ฿8,536. PromptPay is also simply the
    // rail this market prefers. Card is still right there in the second tab.
    const paymentMethodOrder = ['promptpay', 'card'];

    // A declined card (or 3DS failure) leaves the listings already reserved
    // (`sold`) and a re-confirmable PaymentIntent already created. Cache the
    // transfer_group + client_secret so a retry REUSES them instead of calling
    // /api/orders/checkout again — which would re-hit the buyer's OWN reservation
    // and 409 with a misleading "no longer available", locking them out of
    // retrying their own purchase. Reset naturally when Elements remounts (amount
    // /currency/account change) or the modal reopens.
    const retryRef = useRef<{ transferGroup?: string; clientSecret: string | null } | null>(null);

    const handlePay = async () => {
        if (!stripe || !elements) {
            onPaymentFailed('Stripe is not loaded yet. Please try again.');
            return;
        }
        if (apiEndpoint === '/api/checkout' && !extraData?.buyerId) {
            onPaymentFailed('You must be signed in to complete a purchase.');
            return;
        }
        if (!items || items.length === 0) {
            onPaymentFailed('Your cart is empty.');
            return;
        }

        setLoading(true);
        try {
            // Step 1: validate the entered payment details.
            const { error: submitError } = await elements.submit();
            if (submitError) {
                onPaymentFailed(submitError.message || 'Please check your payment details.');
                setLoading(false);
                return;
            }

            const isMarketplace = apiEndpoint === '/api/checkout';

            // Step 2: create pending orders (reserve inventory + get a
            // transfer_group). buyerId is derived from the session server-side.
            // SKIPPED on a retry that already reserved — retryRef holds the
            // transfer_group from the first attempt, so a declined-card retry
            // doesn't re-hit /api/orders/checkout and 409 on the buyer's own
            // now-`sold` listings.
            let transferGroup: string | undefined = retryRef.current?.transferGroup;
            if (isMarketplace && !transferGroup) {
                const orderRes = await fetch('/api/orders/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // 'credit_card' is the value the orders table has always
                    // stored; the actual method (card/PromptPay) is recorded on
                    // the Stripe PaymentIntent. Keep it to avoid any column
                    // constraint surprise.
                    //
                    // expectedTotal is the THB total the buyer is looking at
                    // right now. The server refuses to charge more than this
                    // (returns TOTAL_CHANGED) so the displayed total is what
                    // gets charged.
                    // acceptedOfferId (OBO): the server reads the discounted
                    // price from the accepted offer; we never send a price.
                    body: JSON.stringify({ items, paymentMethod: 'credit_card', expectedTotal: amountThb, ...(acceptedOfferId ? { acceptedOfferId } : {}), ...(voucherId ? { voucherId } : {}) }),
                });
                const orderData = await orderRes.json();
                if (!orderRes.ok || !orderData.success) {
                    if (orderData.code === 'TOTAL_CHANGED' && typeof orderData.total === 'number') {
                        onTotalChanged?.(orderData.total);
                        onPaymentFailed(
                            `Shipping updated — your new total is ${formatAmount(orderData.total)}. Please review and pay again.`
                        );
                    } else {
                        onPaymentFailed(orderData.error || 'Failed to create orders');
                    }
                    setLoading(false);
                    return;
                }
                transferGroup = orderData.transferGroup;
                // Orders now exist at `pending_payment` and the listings are
                // reserved (`sold`). Remember the group so a retry reuses it, and
                // tell the modal so it can release them if the buyer abandons.
                if (transferGroup) {
                    retryRef.current = { transferGroup, clientSecret: null };
                    onOrderReserved?.(transferGroup);
                }
            }

            // Step 3: create (or reuse) the PaymentIntent. On a retry we reuse the
            // client_secret from the first attempt — a declined PI returns to
            // `requires_payment_method` and is re-confirmable with a new card, so
            // minting a second PI here would orphan the first. Server computes the
            // authoritative amount from the orders and pins the currency to THB —
            // the user's display currency is never sent.
            let clientSecret = retryRef.current?.clientSecret ?? null;
            if (!clientSecret) {
                const piRes = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(
                        isMarketplace
                            ? { metadata: { transfer_group: transferGroup } }
                            : { orderId: items[0]?.id, ...extraData }
                    ),
                });
                const piData = await piRes.json();
                if (!piRes.ok || !piData.client_secret) {
                    throw new Error(piData.error || 'Could not start payment');
                }
                clientSecret = piData.client_secret;
                // Cache for retry (marketplace path only — the non-marketplace
                // path reserves nothing, so retryRef stays null there).
                if (retryRef.current) retryRef.current.clientSecret = clientSecret;
            }

            if (!clientSecret) {
                throw new Error('Could not start payment');
            }

            // Step 4: confirm. redirect:'if_required' keeps card + PromptPay
            // inline (Stripe renders the PromptPay QR itself); return_url is
            // only used if a method actually needs a full redirect.
            const returnUrl = typeof window !== 'undefined'
                ? `${window.location.origin}/?payment_status=complete`
                : 'https://cardstreet.app/?payment_status=complete';

            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                clientSecret,
                confirmParams: { return_url: returnUrl },
                redirect: 'if_required',
            });

            if (error) {
                // Reservation + PaymentIntent are retained (retryRef untouched)
                // so the buyer can fix their card and click Pay again without
                // re-reserving their own listings.
                //
                // On a card decline, name PromptPay rather than dead-ending.
                // The issuer has already refused; "try a different card" is the
                // advice that lost the ฿8,536 order three times across two days.
                // PromptPay has no issuer authorisation step to refuse.
                const isCardDecline =
                    error.type === 'card_error' ||
                    error.code === 'card_declined' ||
                    !!(error as { decline_code?: string }).decline_code;
                if (isCardDecline) {
                    setCardDeclined(true);
                    onPaymentFailed(t('paymentFlow.cardDeclinedTryPromptPay'));
                } else {
                    onPaymentFailed(error.message || 'Payment failed');
                }
                setLoading(false);
                return;
            }

            const status = paymentIntent?.status;
            const method = paymentIntent?.payment_method_types?.[0] || 'card';

            if (status === 'succeeded') {
                // Synchronous fulfillment fallback. The webhook is canonical and
                // idempotent (CAS guard in fulfillOrdersByTransferGroup); this
                // just avoids a stuck pending_payment order if the webhook is
                // slow or misconfigured. PromptPay never reaches here (it lands
                // on 'processing'); only the webhook fulfills it.
                if (apiEndpoint === '/api/checkout' && transferGroup && paymentIntent) {
                    try {
                        await fetch('/api/orders/finalize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ transferGroup, paymentIntentId: paymentIntent.id }),
                        });
                    } catch {
                        // Non-blocking — webhook is the canonical path.
                    }
                }
                // Meta Purchase event (web Pixel + native iOS app event). Fired
                // only on settled card payments, not PromptPay 'processing', so
                // unsettled authorizations aren't counted as purchases. Reports
                // the real charge (THB), not the user's display currency.
                trackMetaEvent('Purchase', {
                    value: amountThb,
                    currency: 'THB',
                    content_ids: items.map((i) => i.cardId || i.id).filter(Boolean),
                    content_type: 'product',
                    num_items: items.length,
                });
                onPaymentSuccess({ paymentMethod: method, paymentId: paymentIntent!.id, transferGroup });
            } else if (status === 'processing') {
                // PromptPay (and other async methods): the buyer has authorized;
                // funds settle shortly and the webhook fulfills on succeeded.
                onPaymentSuccess({ paymentMethod: method, paymentId: paymentIntent!.id, transferGroup });
            } else {
                onPaymentFailed('Payment not completed: ' + (status || 'unknown'));
            }
        } catch (e: any) {
            onPaymentFailed(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {cardDeclined && (
                <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 flex items-start gap-3">
                    <i className="fa-solid fa-circle-info text-amber-400 mt-0.5" aria-hidden="true"></i>
                    <p className="text-[13px] leading-snug text-amber-100">
                        {t('paymentFlow.promptPayFallbackHint')}
                    </p>
                </div>
            )}
            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-4 min-h-[44px]">
                <PaymentElement
                    onReady={() => setReady(true)}
                    options={{ layout: 'tabs', paymentMethodOrder }}
                />
            </div>
            <button
                onClick={handlePay}
                disabled={loading || !stripe || !ready}
                className={`mt-4 w-full h-12 rounded-xl font-black uppercase tracking-[0.2em] text-xs transition-all ${loading || !stripe || !ready
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-brand-cyan text-brand-darker hover:bg-white hover:scale-[1.02]'
                    }`}
            >
                {loading
                    ? (t('paymentFlow.processing') || 'Processing…')
                    : `${t('paymentFlow.pay') || 'Pay'} ${formatAmount(amountThb)}`}
            </button>
        </>
    );
};

const PaymentModal: React.FC<PaymentModalProps> = ({
    isOpen,
    onClose,
    amount,
    shippingFee = 0,
    currency,
    exchangeRate = 1,
    items,
    apiEndpoint,
    extraData,
    acceptedOfferId,
    onPaymentSuccess,
    onPaymentFailed
}) => {
    const { t } = useTranslation();

    // ─── Abandoned-checkout cleanup ───
    // /api/orders/checkout reserves inventory (listings → `sold`) and creates
    // `pending_payment` orders BEFORE the Stripe charge. If the buyer then
    // abandons — payment fails, or they close the modal — those reservations
    // would strand the listing as `sold` (gone from the marketplace) forever.
    // We release them when the modal closes/unmounts without a settled payment.
    const reservedGroupRef = useRef<string | null>(null);
    // Set once payment succeeds OR a PromptPay auth begins settling (both call
    // onPaymentSuccess). Guards the release so we never cancel a real order.
    const settledRef = useRef(false);

    const releaseIfAbandoned = useCallback(() => {
        const group = reservedGroupRef.current;
        reservedGroupRef.current = null;
        if (!group || settledRef.current) return;
        // Fire-and-forget; keepalive lets it complete through the unmount. The
        // server CAS (pending_payment + payment_id IS NULL) is the real guard —
        // a payment that already went through is never cancelled.
        try {
            fetch('/api/orders/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transferGroup: group }),
                keepalive: true,
            }).catch(() => {});
        } catch { /* no-op */ }
    }, []);

    // Fresh session state each time the modal opens.
    useEffect(() => {
        if (isOpen) {
            reservedGroupRef.current = null;
            settledRef.current = false;
        }
    }, [isOpen]);

    // Release on close (isOpen → false) or unmount while open.
    useEffect(() => {
        if (!isOpen) return;
        return () => { releaseIfAbandoned(); };
    }, [isOpen, releaseIfAbandoned]);

    const handleOrderReserved = useCallback((transferGroup: string) => {
        reservedGroupRef.current = transferGroup;
    }, []);

    const handlePaymentSuccess = useCallback(
        (details: { paymentMethod: string; paymentId: string; transferGroup?: string }) => {
            settledRef.current = true;      // payment settled/settling — do not release
            reservedGroupRef.current = null;
            onPaymentSuccess(details);
        },
        [onPaymentSuccess],
    );

    // All amounts in this modal are THB (listing prices and the server
    // estimate are THB, and the Stripe charge is THB). A non-THB display
    // currency only changes how they're *formatted* — converted via
    // exchangeRate, with two decimals since the result is fractional.
    const isThbDisplay = currency === 'THB';
    const formatAmount = (thb: number) =>
        isThbDisplay
            ? `฿${thb.toLocaleString()}`
            : `${CURRENCY_SYMBOLS[currency] || currency}${(thb * exchangeRate).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;

    // Server-computed estimate (shipping + total). Fetched on modal open via
    // /api/orders/estimate, which runs the same shipping math as
    // /api/orders/checkout but writes no rows. When this resolves we override
    // the prop amount/shippingFee so the displayed total matches what the
    // buyer will actually be charged.
    const [estimate, setEstimate] = useState<{
        subtotal: number;
        shipping: number;
        total: number;
        shippingIsEstimate: boolean;
        sellerStripeAccountId: string | null;
        sellerPayoutReady: boolean;
    } | null>(null);
    const [estimateLoading, setEstimateLoading] = useState(false);
    const [estimateError, setEstimateError] = useState<string | null>(null);

    // ─── Collector Pass vouchers ───
    // Quoted server-side per cart: the discount clamp depends on the seller's
    // fee tier, which the client can't know. The quoted figure is EXACTLY what
    // /api/orders/checkout will apply (same rules, same rows), so the total
    // shown here is the total charged. Silent no-op while the rewards/voucher
    // flags are dark or the buyer has no vouchers. Never combined with an
    // accepted offer.
    interface VoucherQuote {
        id: string;
        key: string;
        amountSatang: number;
        discountSatang: number;
        eligible: boolean;
    }
    const [vouchers, setVouchers] = useState<VoucherQuote[]>([]);
    const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
    useEffect(() => {
        if (!isOpen || apiEndpoint !== '/api/checkout' || !items || items.length === 0 || acceptedOfferId) {
            setVouchers([]);
            setSelectedVoucherId(null);
            return;
        }
        let cancelled = false;
        fetch('/api/rewards/vouchers/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ items: items.map((i) => ({ id: i.id })) }),
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (cancelled || !d?.enabled) return;
                setVouchers(
                    ((d.vouchers ?? []) as VoucherQuote[]).filter((v) => v.eligible && v.discountSatang > 0),
                );
            })
            .catch(() => { /* vouchers simply don't render */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, apiEndpoint, acceptedOfferId]);
    const voucherDiscountThb =
        (vouchers.find((v) => v.id === selectedVoucherId)?.discountSatang ?? 0) / 100;

    useEffect(() => {
        if (!isOpen) {
            setEstimate(null);
            setEstimateError(null);
            return;
        }
        if (!items?.length) return;

        let cancelled = false;
        setEstimateLoading(true);
        setEstimateError(null);

        // Auth comes from cookie session. Only the listing ids are sent — the
        // server re-derives sellers and prices from the DB.
        fetch('/api/orders/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items.map(i => ({ id: i.id })), ...(acceptedOfferId ? { acceptedOfferId } : {}) }),
        })
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                if (!data.success) {
                    setEstimateError(data.error || 'Failed to estimate total');
                    return;
                }
                setEstimate({
                    subtotal: data.subtotal,
                    shipping: data.shipping,
                    total: data.total,
                    shippingIsEstimate: !!data.shippingIsEstimate,
                    sellerStripeAccountId: data.sellerStripeAccountId ?? null,
                    // Default true if the field is absent (older server / US
                    // legacy path) so we never block those flows.
                    sellerPayoutReady: data.sellerPayoutReady !== false,
                });
            })
            .catch(err => {
                if (!cancelled) setEstimateError(err.message || 'Failed to estimate total');
            })
            .finally(() => {
                if (!cancelled) setEstimateLoading(false);
            });

        return () => { cancelled = true; };
    }, [isOpen, items, acceptedOfferId]);

    // Effective display values — prefer the server estimate, fall back to the
    // prop amount (cart subtotal) before the estimate arrives.
    const effectiveAmount = estimate?.total ?? amount;
    // What the buyer actually pays: the estimate total minus the exact quoted
    // voucher discount (fee-funded; can only lower the charge).
    const displayedTotal = Math.max(0, effectiveAmount - voucherDiscountThb);
    const effectiveShipping = estimate?.shipping ?? shippingFee;

    // For the marketplace checkout we must wait for the estimate before
    // mounting Elements, because it tells us which connected account to bind
    // Stripe.js to (TH direct charge). Mounting on the platform first and
    // swapping later would tokenize the card on the wrong account. Other
    // (non-marketplace) callers tokenize on the platform immediately.
    const isMarketplaceCheckout = (apiEndpoint ?? '/api/checkout') === '/api/checkout';
    const stripeAccountForElements = isMarketplaceCheckout ? estimate?.sellerStripeAccountId ?? null : null;
    const waitingForEstimate = isMarketplaceCheckout && !estimate && !estimateError;

    // Resolve Stripe.js here instead of handing the promise to <Elements>.
    // react-stripe-js calls .then() on the prop with no rejection handler, so a
    // blocked js.stripe.com surfaced in Sentry as an *unhandled* "Failed to
    // load Stripe.js" and left the buyer on a permanently empty card field —
    // no error, no way to retry. Resolving it ourselves gives both.
    // Tagged with the account it was loaded for: <Elements> refuses to swap its
    // `stripe` prop after mount, so handing it a platform-scoped instance while
    // the seller's account is still resolving would pin the whole checkout to
    // the wrong account (the failure the comment above warns about).
    const [stripe, setStripe] = useState<{ account: string | null; instance: Stripe } | null>(null);
    const [stripeLoadFailed, setStripeLoadFailed] = useState(false);
    const [stripeAttempt, setStripeAttempt] = useState(0);

    useEffect(() => {
        if (!isOpen) return;
        // On the marketplace path the connected account isn't known until the
        // estimate lands. Stripe.js itself is already downloading by then (the
        // SDK injects its script on import), so this costs no real latency.
        if (waitingForEstimate) return;

        const account = stripeAccountForElements;
        const promise = getStripePromise(account);
        if (!promise) return;

        let cancelled = false;
        setStripeLoadFailed(false);
        promise.then(
            (loaded) => {
                if (cancelled) return;
                setStripe(loaded ? { account, instance: loaded } : null);
                // A null resolve means an invalid/blank publishable key —
                // same dead-field outcome as a failed script load.
                setStripeLoadFailed(!loaded);
            },
            () => {
                if (cancelled) return;
                setStripe(null);
                setStripeLoadFailed(true);
            },
        );
        return () => { cancelled = true; };
    }, [isOpen, waitingForEstimate, stripeAccountForElements, stripeAttempt]);

    const stripeInstance = stripe && stripe.account === stripeAccountForElements ? stripe.instance : null;

    // List-first: a seller may list before finishing Stripe verification, but a
    // buyer can't pay until that seller's account can receive charges. Block the
    // pay step up front so the buyer never submits a checkout the server would
    // reject. The authoritative block is server-side in /api/orders/checkout.
    const sellerNotReady = isMarketplaceCheckout && !!estimate && !estimate.sellerPayoutReady;

    // Deferred PaymentElement options. amount is in satang and is only used to
    // render eligible methods + wallet amounts; the authoritative charge
    // amount is set server-side on the PaymentIntent. The currency is pinned
    // to THB for the marketplace checkout — it must match the PaymentIntent
    // /api/checkout creates, and mounting Elements in the user's *display*
    // currency would both mismatch the PI and hide PromptPay (THB-only).
    // Dark theme to match the modal.
    const amountMinor = Math.max(1, Math.round(displayedTotal * 100));
    const elementsCurrency = isMarketplaceCheckout ? 'thb' : (currency || 'thb').toLowerCase();
    const elementsOptions = useMemo<StripeElementsOptions>(() => ({
        mode: 'payment',
        amount: amountMinor,
        currency: elementsCurrency,
        appearance: {
            theme: 'night',
            variables: { colorPrimary: '#22d3ee', borderRadius: '12px' },
        },
    }), [amountMinor, elementsCurrency]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-slate-900 w-full max-w-sm rounded-[2rem] border border-white/10 max-h-[90dvh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-darker to-slate-800 p-6 border-b border-white/5 flex justify-between items-center">
                    <div>
                        <h3 className="text-white text-lg font-black italic skew-x-[-10deg]">{t('paymentFlow.secureTitle') || 'Secure Payment'}</h3>
                        <p className="text-[10px] text-brand-green font-bold uppercase tracking-widest">{t('paymentFlow.secureSubtitle') || 'Encrypted checkout'}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 bg-white/5 rounded-xl p-4 space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Subtotal</span>
                            <span className="text-sm font-bold text-slate-300">{formatAmount(effectiveAmount - effectiveShipping)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Shipping</span>
                            <span className="text-sm font-bold text-brand-cyan">
                                {estimateLoading
                                    ? 'Calculating…'
                                    : effectiveShipping > 0
                                        ? `+${formatAmount(effectiveShipping)}`
                                        : formatAmount(0)}
                            </span>
                        </div>
                        {estimateError && (
                            <p className="text-[10px] text-amber-400 italic">
                                Could not calculate shipping — showing subtotal only. Final amount will reflect actual shipping.
                            </p>
                        )}
                        {!estimateError && estimate?.shippingIsEstimate && (
                            <p className="text-[10px] text-slate-500 italic">
                                {t('paymentFlow.shippingEstimate') || "Flat-rate shipping for this address — you'll be charged exactly the total shown above."}
                            </p>
                        )}
                        {vouchers.length > 0 && (
                            <div className="pt-1">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1.5">
                                    {t('rewards.voucherApply') || 'Voucher'}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        onClick={() => setSelectedVoucherId(null)}
                                        className={`px-2.5 h-7 rounded-lg text-[10px] font-black uppercase transition-colors ${
                                            selectedVoucherId === null
                                                ? 'bg-white/20 text-white'
                                                : 'bg-white/5 text-slate-400'
                                        }`}
                                    >
                                        {t('rewards.voucherNone') || 'None'}
                                    </button>
                                    {vouchers.map((v) => (
                                        <button
                                            key={v.id}
                                            onClick={() => setSelectedVoucherId(v.id)}
                                            className={`px-2.5 h-7 rounded-lg text-[10px] font-black transition-colors flex items-center gap-1 ${
                                                selectedVoucherId === v.id
                                                    ? 'bg-amber-400 text-slate-900'
                                                    : 'bg-amber-400/10 text-amber-300 border border-amber-400/30'
                                            }`}
                                        >
                                            <i className="fa-solid fa-ticket text-[9px]"></i>
                                            -฿{(v.discountSatang / 100).toLocaleString()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {voucherDiscountThb > 0 && (
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                                    {t('rewards.discount') || 'Voucher discount'}
                                </span>
                                <span className="text-sm font-bold text-amber-300">-{formatAmount(voucherDiscountThb)}</span>
                            </div>
                        )}
                        <div className="h-[1px] w-full bg-white/10 my-2"></div>
                        <div className="flex justify-between items-center">
                            <span className="text-white text-sm font-black uppercase tracking-wider">Total</span>
                            <span className="text-2xl font-black text-white">{formatAmount(displayedTotal)}</span>
                        </div>
                        {!isThbDisplay && (
                            <p className="text-[10px] text-slate-500 text-right">
                                {t('paymentFlow.chargedInThb') || 'Charged in Thai Baht as'} ฿{displayedTotal.toLocaleString()}.{' '}
                                {t('paymentFlow.bankRateNote') || 'Your bank sets the final exchange rate.'}
                            </p>
                        )}
                    </div>

                    <div className="space-y-3">
                        {!PUBLISHABLE_KEY ? (
                            // PUBLISHABLE_KEY missing/empty — render a clear message
                            // instead of a silently dead card field + greyed button.
                            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-xl p-4 text-center">
                                {t('paymentFlow.paymentUnavailable')
                                    || 'Card payments are temporarily unavailable. Please try again later.'}
                            </div>
                        ) : waitingForEstimate ? (
                            <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-6">
                                <i className="fa-solid fa-circle-notch fa-spin"></i>
                                {t('paymentFlow.preparingCheckout') || 'Preparing secure checkout…'}
                            </div>
                        ) : sellerNotReady ? (
                            // Seller listed before finishing Stripe verification —
                            // no account can receive the charge yet, so hide the
                            // card field instead of letting the buyer hit a reject.
                            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-xl p-4 text-center">
                                {t('paymentFlow.sellerUnverified')
                                    || 'This seller is still finishing payment setup and cannot accept orders yet. Please check back soon.'}
                            </div>
                        ) : stripeLoadFailed ? (
                            // js.stripe.com never loaded — almost always an
                            // ad/tracker blocker or a dropped connection, both
                            // of which a retry can clear.
                            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-xl p-4 text-center space-y-3">
                                <p>
                                    {t('paymentFlow.stripeBlocked')
                                        || "Couldn't load the secure payment form. An ad blocker or your network may be blocking Stripe — disable it for this site and try again."}
                                </p>
                                <button
                                    onClick={() => setStripeAttempt(n => n + 1)}
                                    className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                                >
                                    {t('paymentFlow.retry') || 'Try again'}
                                </button>
                            </div>
                        ) : !stripeInstance ? (
                            <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-6">
                                <i className="fa-solid fa-circle-notch fa-spin"></i>
                                {t('paymentFlow.preparingCheckout') || 'Preparing secure checkout…'}
                            </div>
                        ) : (
                            <>
                                <Elements
                                    stripe={stripeInstance}
                                    options={elementsOptions}
                                    // Deferred Elements can't change amount/currency/account in
                                    // place — remount when any of them changes.
                                    key={`${amountMinor}-${elementsCurrency}-${estimate?.sellerStripeAccountId || 'platform'}`}
                                >
                                    <PaymentElementForm
                                        amountThb={displayedTotal}
                                        formatAmount={formatAmount}
                                        items={items}
                                        apiEndpoint={apiEndpoint}
                                        extraData={extraData}
                                        acceptedOfferId={acceptedOfferId}
                                        voucherId={selectedVoucherId}
                                        onOrderReserved={handleOrderReserved}
                                        onPaymentSuccess={handlePaymentSuccess}
                                        onPaymentFailed={onPaymentFailed}
                                        onTotalChanged={(newTotal) =>
                                            setEstimate((prev) =>
                                                prev
                                                    ? { ...prev, total: newTotal, shipping: newTotal - prev.subtotal }
                                                    : prev
                                            )
                                        }
                                    />
                                </Elements>
                                <p className="text-center text-[10px] text-slate-600 flex items-center justify-center gap-1 mt-2">
                                    <i className="fa-brands fa-stripe text-slate-500 text-sm"></i>
                                    Secured by Stripe
                                </p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
