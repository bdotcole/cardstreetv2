'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { formatSatang } from '@/components/live/shared';

/**
 * On-session checkout for HELD break spots:
 *
 *   1. POST /api/live/spots/checkout {spotIds}
 *        -> pending_payment orders + transferGroup + totalSatang
 *           + sellerStripeAccount (which connected account to tokenize on)
 *   2. POST /api/checkout {metadata:{transfer_group}} -> client_secret
 *        (the PaymentIntent is created ON the seller's connected account —
 *         TH direct charge, seller is MOR)
 *   3. stripe.confirmPayment via PaymentElement (card + PromptPay)
 *   4. POST /api/live/spots/finalize {transferGroup, paymentIntentId}
 *        -> orders flip paid, spots flip sold, the board updates via Realtime
 *
 * Both server calls happen up front (on open) so Elements can mount with the
 * PI's client_secret directly — unlike PaymentModal there is no separate
 * shipping estimate to wait for: spots/checkout itself quotes a base fee for
 * each lot the buyer is buying from for the FIRST time (repeat lots are free
 * apart from an optional per-spot increment) and returns the batch's summed
 * total as shippingSatang.
 */

// Mirrors components/PaymentModal.tsx: NEXT_PUBLIC_* must be read as static
// member accesses for Next to inline them, and the value is trimmed because a
// pasted trailing newline makes loadStripe() reject the key.
const PUBLISHABLE_KEY = (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TH ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ''
).trim();

// Stripe.js cached PER CONNECTED ACCOUNT (TH direct charge tokenizes the card
// in the SELLER's account context), with failed loads evicted so a blocked
// js.stripe.com doesn't poison the rest of the session. Same pattern as
// PaymentModal — kept local because that module doesn't export its cache.
const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(stripeAccount?: string | null): ReturnType<typeof loadStripe> | null {
    if (!PUBLISHABLE_KEY) return null;
    const cacheKey = stripeAccount || '__platform__';
    let promise = stripePromiseCache.get(cacheKey);
    if (!promise) {
        promise = loadStripe(PUBLISHABLE_KEY, stripeAccount ? { stripeAccount } : undefined);
        promise.catch(() => {
            stripePromiseCache.delete(cacheKey);
        });
        stripePromiseCache.set(cacheKey, promise);
    }
    return promise;
}

/**
 * Failures that Try Again cannot fix, because re-confirming re-submits the
 * same unchargeable amount: our own pre-flight floor check (MIN_CHARGE) and
 * Stripe's rejection if a sub-floor batch ever slips past it
 * (amount_too_small). Both mean the same thing to the buyer — the batch is
 * under ฿10 — so they share one message, and the sheet releases the holds
 * instead of leaving the board reserved behind a dead-end error.
 */
const HARD_FAILURE_CODES = new Set(['MIN_CHARGE', 'amount_too_small']);

function isHardFailure(code: unknown): boolean {
    return typeof code === 'string' && HARD_FAILURE_CODES.has(code);
}

/** Carries the server/Stripe error code through the init's throw path. */
class CheckoutError extends Error {
    code?: string;
    constructor(message: string, code?: unknown) {
        super(message);
        this.code = typeof code === 'string' ? code : undefined;
    }
}

export interface PayableSpot {
    id: string;
    spotNumber: number;
    priceSatang: number;
}

interface SpotPaymentSheetProps {
    open: boolean;
    spots: PayableSpot[];
    onClose: () => void;
    /** Payment settled (or is settling async) — parent clears its local hold
     *  state; the board itself flips via Realtime when spots turn sold. */
    onSuccess: () => void;
    /** The buyer backed out after a failure and the holds were released. */
    onReleased: () => void;
}

type Phase =
    | { name: 'preparing' }
    | { name: 'ready' }
    | { name: 'paying' }
    | { name: 'success'; processingAsync: boolean }
    /** `hard` = unretryable; the holds are already released and the only
     *  action offered is Dismiss. */
    | { name: 'error'; message: string; hard: boolean };

interface CheckoutSession {
    transferGroup: string;
    totalSatang: number;
    /** Pre-discount sum of the spots' prices; equals totalSatang when no
     *  bulk-discount tier applied. */
    originalTotalSatang: number;
    /** Pre-shipping items discount (0 = no discount). */
    discountSatang: number;
    /** Shipping included in totalSatang, summed across the batch's lots
     *  (base fee per newly-bought lot + per-spot increments — one line, no
     *  per-lot breakdown): > 0 = the summed fees, 0 = free shipping, null =
     *  pre-20260816 server (no shipping line rendered). */
    shippingSatang: number | null;
    sellerStripeAccount: string | null;
    clientSecret: string;
}

const PayForm: React.FC<{
    totalSatang: number;
    paying: boolean;
    onPay: () => void;
}> = ({ totalSatang, paying, onPay }) => {
    const { t } = useTranslation();
    const stripe = useStripe();
    const [ready, setReady] = useState(false);
    const disabled = paying || !stripe || !ready;
    return (
        <>
            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-4 min-h-[44px]">
                <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
            </div>
            <button
                onClick={onPay}
                disabled={disabled}
                className={`mt-4 w-full h-12 rounded-xl font-black uppercase tracking-[0.2em] text-xs transition-all ${
                    disabled
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-brand-cyan text-brand-darker hover:bg-white'
                }`}
            >
                {paying
                    ? t('live.payment.processing') || 'Processing...'
                    : `${t('live.payment.pay') || 'Pay'} ${formatSatang(totalSatang)}`}
            </button>
        </>
    );
};

// confirmPayment needs useStripe/useElements, which must live under
// <Elements> — this bridge lifts the confirm handler out to the sheet.
interface ConfirmResult {
    error?: string;
    /** Stripe's error code — 'card_declined' (retryable) vs
     *  'amount_too_small' (not). */
    code?: string;
    paymentIntentId?: string;
    status?: string;
}

const ConfirmBridge: React.FC<{
    register: (fn: () => Promise<ConfirmResult>) => void;
}> = ({ register }) => {
    const stripe = useStripe();
    const elements = useElements();

    useEffect(() => {
        register(async () => {
            if (!stripe || !elements) return { error: 'Stripe is not loaded yet' };
            const returnUrl =
                typeof window !== 'undefined'
                    ? `${window.location.origin}${window.location.pathname}`
                    : 'https://cardstreet.app/live';
            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: { return_url: returnUrl },
                redirect: 'if_required',
            });
            if (error) return { error: error.message || 'Payment failed', code: error.code };
            return { paymentIntentId: paymentIntent?.id, status: paymentIntent?.status };
        });
    }, [stripe, elements, register]);

    return null;
};

const SpotPaymentSheet: React.FC<SpotPaymentSheetProps> = ({
    open,
    spots,
    onClose,
    onSuccess,
    onReleased,
}) => {
    const { t } = useTranslation();
    const [phase, setPhase] = useState<Phase>({ name: 'preparing' });
    const [session, setSession] = useState<CheckoutSession | null>(null);
    const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);
    const [releasing, setReleasing] = useState(false);
    // Bumped to re-run the init effect when a PREPARING-phase failure is
    // retried (no session to fall back to, so the whole setup must re-run).
    const [attempt, setAttempt] = useState(0);
    const confirmRef = useRef<(() => Promise<ConfirmResult>) | null>(null);
    const registerConfirm = useCallback((fn: () => Promise<ConfirmResult>) => {
        confirmRef.current = fn;
    }, []);

    const spotIdsKey = spots.map((s) => s.id).join(',');
    // Teardown must work from the unmount cleanup, which cannot depend on the
    // changing `spots` prop without re-running (and re-arming) every render.
    const spotIdsRef = useRef<string[]>([]);
    spotIdsRef.current = spots.map((s) => s.id);
    // Payment settled (incl. PromptPay still 'processing') — the group is the
    // buyer's; closing must never tear it down.
    const settledRef = useRef(false);
    const abandonedRef = useRef(false);
    // A confirm is in flight. Tearing the group down mid-confirm could cancel
    // the orders for a payment Stripe is about to accept, so teardown waits.
    const confirmInFlightRef = useRef(false);
    // The in-flight init, so a dismiss during 'preparing' abandons the orders
    // that request is still creating instead of racing past them.
    const initPromiseRef = useRef<Promise<void> | null>(null);
    // Guards the init against re-runs that would mint DUPLICATE pending orders:
    // React StrictMode's double effect invoke, and the sheet being closed and
    // reopened on the same spots (the component stays mounted; the existing
    // session's PaymentIntent is still confirmable). A new spot set or an
    // explicit retry bump gets a fresh key and re-inits.
    const initKeyRef = useRef<string | null>(null);

    /**
     * Tear the payable group down: CAS-cancel the pending_payment orders this
     * sheet minted and release the holds behind them. Used on unretryable
     * failures and on dismissing an unpaid sheet — both used to leave the
     * board showing the spots as reserved until the hold lapsed.
     *
     * Waits on any in-flight init first, so dismissing mid-'preparing'
     * abandons the orders that request is still creating rather than racing
     * past them. `keepalive` lets the request outlive an unmount that comes
     * with a navigation. Best-effort by design — the server side is
     * CAS-guarded and idempotent, and the hold expires on its own regardless.
     */
    const abandonNow = useCallback(async () => {
        // No init has run for this spot set, so there is no payable group and
        // no extended hold to undo — the buyer's plain claim-holds are the
        // board's business, not the sheet's. Also what keeps StrictMode's
        // simulated mount/unmount from tearing down a group at mount time.
        if (initKeyRef.current === null) return;
        if (abandonedRef.current || settledRef.current || confirmInFlightRef.current) return;
        abandonedRef.current = true;
        // A later checkout on the same spots must re-init rather than restore
        // the session that just died with these orders.
        initKeyRef.current = null;
        const spotIds = spotIdsRef.current;
        if (spotIds.length === 0) return;
        try {
            await fetch('/api/live/spots/abandon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spotIds }),
                keepalive: true,
            });
        } catch {
            // Nothing useful to do — the hold's own expiry is the backstop.
        }
    }, []);

    // Callers outside the init wait for it first. The init's own failure path
    // calls abandonNow directly — awaiting its own promise would deadlock.
    const abandonGroup = useCallback(async () => {
        if (abandonedRef.current || settledRef.current) return;
        try {
            await initPromiseRef.current;
        } catch {
            // An init that threw may still have created orders — abandon anyway.
        }
        await abandonNow();
    }, [abandonNow]);

    // Closing the sheet without paying is an abandon, not a pause: the orders
    // are cancelled and the spots go back on the board. Only a settled group
    // closes untouched.
    const dismiss = useCallback(() => {
        if (settledRef.current) {
            onClose();
            return;
        }
        // Either the group was already torn down (hard failure) or it is now —
        // both end with the spots back on the board, so the parent needs
        // onReleased, which closes the sheet AND syncs its board state. A bare
        // onClose would leave the board showing holds that no longer exist.
        void abandonGroup();
        onReleased();
    }, [abandonGroup, onClose, onReleased]);

    // Unmount (route change, viewer teardown) is the same abandon.
    useEffect(
        () => () => {
            void abandonGroup();
        },
        [abandonGroup],
    );

    // ─── Open: create orders + PaymentIntent, then load Stripe.js bound to
    //     the seller's connected account. Re-runs if the spot set changes. ───
    useEffect(() => {
        if (!open || spots.length === 0) return;
        const initKey = `${spotIdsKey}:${attempt}`;
        if (initKeyRef.current === initKey) {
            // Same spots, same attempt: restore the ready view if a session
            // already exists instead of re-creating orders.
            if (session) setPhase({ name: 'ready' });
            return;
        }
        initKeyRef.current = initKey;
        // A fresh group: nothing settled, nothing abandoned yet.
        settledRef.current = false;
        abandonedRef.current = false;
        setPhase({ name: 'preparing' });
        setSession(null);
        setStripeInstance(null);

        initPromiseRef.current = (async () => {
            try {
                const checkoutRes = await fetch('/api/live/spots/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spotIds: spots.map((s) => s.id) }),
                });
                const checkoutData = await checkoutRes.json();
                if (!checkoutRes.ok || !checkoutData.success) {
                    throw new CheckoutError(
                        checkoutData.error || t('live.payment.startError') || 'Could not start checkout',
                        checkoutData.code,
                    );
                }

                const piRes = await fetch('/api/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        metadata: { transfer_group: checkoutData.transferGroup },
                    }),
                });
                const piData = await piRes.json();
                if (!piRes.ok || !piData.client_secret) {
                    throw new CheckoutError(
                        piData.error || t('live.payment.startError') || 'Could not start checkout',
                        piData.code,
                    );
                }

                const account: string | null = checkoutData.sellerStripeAccount ?? null;
                const stripePromise = getStripePromise(account);
                const stripe = stripePromise ? await stripePromise : null;
                if (!stripe) throw new Error('Stripe failed to load');

                setSession({
                    transferGroup: checkoutData.transferGroup,
                    totalSatang: checkoutData.totalSatang,
                    // Pre-20260813 servers omit the discount fields — fall
                    // back to "no discount" rather than NaN line items.
                    originalTotalSatang:
                        typeof checkoutData.originalTotalSatang === 'number'
                            ? checkoutData.originalTotalSatang
                            : checkoutData.totalSatang,
                    discountSatang:
                        typeof checkoutData.discountSatang === 'number'
                            ? checkoutData.discountSatang
                            : 0,
                    shippingSatang:
                        typeof checkoutData.shippingSatang === 'number'
                            ? checkoutData.shippingSatang
                            : null,
                    sellerStripeAccount: account,
                    clientSecret: piData.client_secret,
                });
                setStripeInstance(stripe);
                setPhase({ name: 'ready' });
            } catch (err: any) {
                const hard = isHardFailure(err?.code);
                if (hard) {
                    // Try Again cannot fix this — hand the spots straight back
                    // rather than leave the board reserved behind a dead end.
                    void abandonNow();
                }
                setPhase({
                    name: 'error',
                    message: hard
                        ? t('live.payment.minCharge') ||
                          'Minimum purchase is ฿10 — add another spot'
                        : err?.message || t('live.payment.startError') || 'Could not start checkout',
                    hard,
                });
            }
        })();

        // No cleanup-cancel on purpose: initKeyRef already prevents duplicate
        // POSTs (incl. StrictMode's double invoke), and discarding the results
        // of the single in-flight init would strand the sheet on 'preparing'.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, spotIdsKey, attempt]);

    const handlePay = useCallback(async () => {
        const confirm = confirmRef.current;
        const current = session;
        if (!confirm || !current) return;
        setPhase({ name: 'paying' });
        confirmInFlightRef.current = true;
        const result = await confirm();
        confirmInFlightRef.current = false;
        if (result.error) {
            // A decline or a PromptPay timeout leaves the PI re-confirmable,
            // so the hold and Try Again both stay. Only a hard failure tears
            // the group down.
            const hard = isHardFailure(result.code);
            if (hard) void abandonGroup();
            setPhase({
                name: 'error',
                message: hard
                    ? t('live.payment.minCharge') || 'Minimum purchase is ฿10 — add another spot'
                    : result.error,
                hard,
            });
            return;
        }

        const settled = result.status === 'succeeded';
        const processingAsync = result.status === 'processing';
        if (!settled && !processingAsync) {
            setPhase({
                name: 'error',
                message: `${t('live.payment.failed') || 'Payment failed'} (${result.status || 'unknown'})`,
                hard: false,
            });
            return;
        }
        // From here the money is the buyer's problem no longer — never let a
        // close or unmount cancel the group behind a settled payment.
        settledRef.current = true;

        // Finalize flips orders -> paid and spots -> sold. For async methods
        // (PromptPay) the PI is still 'processing', so finalize is expected to
        // refuse — the payment webhook settles it; the attempt here is only the
        // fast path for cards. Never fail the UX over it.
        if (result.paymentIntentId) {
            try {
                await fetch('/api/live/spots/finalize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transferGroup: current.transferGroup,
                        paymentIntentId: result.paymentIntentId,
                    }),
                });
            } catch {
                // Realtime + webhook remain the canonical path.
            }
        }
        setPhase({ name: 'success', processingAsync });
        onSuccess();
    }, [session, onSuccess, abandonGroup, t]);

    // Failure path: give the buyer their spots back so the board unblocks for
    // everyone else instead of pinning the hold until it expires. Goes through
    // the same abandon teardown as a dismiss, so the pending orders behind the
    // holds die with them rather than lingering as a chargeable group.
    const handleRelease = useCallback(async () => {
        setReleasing(true);
        try {
            await abandonGroup();
        } finally {
            setReleasing(false);
            onReleased();
        }
    }, [abandonGroup, onReleased]);

    if (!open) return null;

    const totalSatang = session?.totalSatang ?? spots.reduce((sum, s) => sum + s.priceSatang, 0);
    // The per-spot rows show original prices, so a bulk discount gets its own
    // original-subtotal + discount lines above the (discounted) total.
    const discountSatang = session?.discountSatang ?? 0;

    return (
        <AnimatePresence>
            <motion.div
                key="spot-payment-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] flex items-end lg:items-center justify-center bg-black/80 backdrop-blur-md"
            >
                <motion.div
                    key="spot-payment-sheet"
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 80, opacity: 0 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    className="w-full max-w-md bg-slate-900 rounded-t-[2rem] lg:rounded-[2rem] border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto"
                >
                    <div className="p-5 border-b border-white/5 flex items-center justify-between">
                        <div>
                            <h3 className="text-white text-base font-black uppercase tracking-wide">
                                {t('live.payment.title') || 'Spot checkout'}
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                {spots.length} {t('live.payment.spots') || 'Spots'}
                            </p>
                        </div>
                        <button
                            onClick={dismiss}
                            aria-label={t('live.payment.close') || 'Close'}
                            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400"
                        >
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div className="p-5">
                        {/* Line items */}
                        <div className="bg-white/5 rounded-xl p-4 mb-5 space-y-1.5">
                            {spots.map((s) => (
                                <div key={s.id} className="flex justify-between items-center text-sm">
                                    <span className="text-slate-400 font-bold">
                                        {t('live.payment.spotLabel')} #{s.spotNumber}
                                    </span>
                                    <span className="text-slate-200 font-bold">{formatSatang(s.priceSatang)}</span>
                                </div>
                            ))}
                            {discountSatang > 0 && session && (
                                <>
                                    <div className="flex justify-between items-center pt-2 mt-1 border-t border-white/10 text-sm">
                                        <span className="text-slate-400 font-bold">
                                            {t('live.payment.subtotal') || 'Subtotal'}
                                        </span>
                                        <span className="text-slate-400 font-bold line-through">
                                            {formatSatang(session.originalTotalSatang)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-emerald-300 font-bold">
                                            {t('live.payment.bulkDiscount') || 'Bulk discount'}
                                        </span>
                                        <span className="text-emerald-300 font-bold">
                                            -{formatSatang(discountSatang)}
                                        </span>
                                    </div>
                                </>
                            )}
                            {/* Shipping (20260816 servers send shippingSatang): one
                                summed line — a base fee for each lot bought from for
                                the first time (fees stack when a batch opens several
                                lots) plus any increments; 0 renders the free-shipping
                                state. */}
                            {session && session.shippingSatang !== null && (
                                <div className="flex justify-between items-center pt-2 mt-1 border-t border-white/10 text-sm">
                                    {session.shippingSatang > 0 ? (
                                        <>
                                            <span className="text-slate-400 font-bold">
                                                {t('live.payment.shipping') || 'Shipping'}
                                            </span>
                                            <span className="text-slate-200 font-bold">
                                                {formatSatang(session.shippingSatang)}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-emerald-300 font-bold">
                                                {t('live.payment.freeShipping') || 'Free shipping'}
                                            </span>
                                            <span className="text-emerald-300 font-bold">
                                                {formatSatang(0)}
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                            <div className="flex justify-between items-center pt-2 mt-1 border-t border-white/10">
                                <span className="text-xs font-black uppercase tracking-widest text-slate-300">
                                    {t('live.payment.total') || 'Total'}
                                </span>
                                <span className="text-brand-cyan font-black">{formatSatang(totalSatang)}</span>
                            </div>
                        </div>

                        {phase.name === 'preparing' && (
                            <div className="py-10 text-center">
                                <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-xl"></i>
                                <p className="text-xs text-slate-400 mt-3">
                                    {t('live.payment.preparing') || 'Preparing checkout...'}
                                </p>
                            </div>
                        )}

                        {(phase.name === 'ready' || phase.name === 'paying') &&
                            session &&
                            stripeInstance && (
                                <Elements
                                    stripe={stripeInstance}
                                    options={{
                                        clientSecret: session.clientSecret,
                                        appearance: {
                                            theme: 'night',
                                            variables: { colorPrimary: '#22d3ee', borderRadius: '12px' },
                                        },
                                    }}
                                >
                                    <ConfirmBridge register={registerConfirm} />
                                    <PayForm
                                        totalSatang={session.totalSatang}
                                        paying={phase.name === 'paying'}
                                        onPay={handlePay}
                                    />
                                </Elements>
                            )}

                        {phase.name === 'success' && (
                            <div className="py-8 text-center">
                                <div className="w-14 h-14 rounded-full bg-brand-green/10 flex items-center justify-center mx-auto mb-4">
                                    <i className="fa-solid fa-check text-brand-green text-xl"></i>
                                </div>
                                <p className="text-white font-black uppercase tracking-wide">
                                    {t('live.payment.success') || 'Spots secured'}
                                </p>
                                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                                    {phase.processingAsync
                                        ? t('live.payment.processingNote') ||
                                          'Payment is settling — your spots will confirm shortly'
                                        : t('live.payment.successDesc') || "You're locked in — enjoy the break"}
                                </p>
                                <button
                                    onClick={onClose}
                                    className="mt-5 px-6 h-11 rounded-xl bg-white/10 text-white text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                                >
                                    {t('live.payment.close') || 'Close'}
                                </button>
                            </div>
                        )}

                        {phase.name === 'error' && (
                            <div className="py-6 text-center">
                                <div className="w-14 h-14 rounded-full bg-brand-red/10 flex items-center justify-center mx-auto mb-4">
                                    <i className="fa-solid fa-triangle-exclamation text-brand-red text-xl"></i>
                                </div>
                                <p className="text-white font-black uppercase tracking-wide">
                                    {t('live.payment.failed') || 'Payment failed'}
                                </p>
                                <p className="text-xs text-slate-400 mt-2 leading-relaxed break-words">
                                    {phase.message}
                                </p>
                                {phase.hard ? (
                                    // Unretryable: the holds are already released, so
                                    // Try Again and Release would both be lies.
                                    <>
                                        <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
                                            {t('live.payment.holdsReleased') ||
                                                'Your spots have been released'}
                                        </p>
                                        <button
                                            onClick={dismiss}
                                            className="mt-5 px-6 h-11 rounded-xl bg-white/10 text-white text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                                        >
                                            {t('live.payment.dismiss') || 'Dismiss'}
                                        </button>
                                    </>
                                ) : (
                                    <div className="mt-5 flex gap-3 justify-center">
                                        <button
                                            // A declined PI drops back to requires_payment_method and
                                            // stays re-confirmable — with a session, retry just remounts
                                            // Elements on the SAME client_secret. Without one, the whole
                                            // setup re-runs via the attempt bump.
                                            onClick={() =>
                                                session ? setPhase({ name: 'ready' }) : setAttempt((a) => a + 1)
                                            }
                                            className="px-5 h-11 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest hover:bg-white transition-all"
                                        >
                                            {t('live.payment.retry') || 'Try again'}
                                        </button>
                                        <button
                                            onClick={handleRelease}
                                            disabled={releasing}
                                            className="px-5 h-11 rounded-xl bg-white/10 text-slate-300 text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-50"
                                        >
                                            {releasing
                                                ? t('live.payment.processing') || 'Processing...'
                                                : t('live.payment.release') || 'Release my spots'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default SpotPaymentSheet;
