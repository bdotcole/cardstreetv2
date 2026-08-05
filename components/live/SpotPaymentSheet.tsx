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
 * PI's client_secret directly — unlike PaymentModal there is no shipping
 * estimate to wait for; the spot prices are already locked by the hold.
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
    | { name: 'error'; message: string };

interface CheckoutSession {
    transferGroup: string;
    totalSatang: number;
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
const ConfirmBridge: React.FC<{
    register: (fn: () => Promise<{ error?: string; paymentIntentId?: string; status?: string }>) => void;
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
            if (error) return { error: error.message || 'Payment failed' };
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
    const confirmRef = useRef<
        (() => Promise<{ error?: string; paymentIntentId?: string; status?: string }>) | null
    >(null);
    const registerConfirm = useCallback(
        (fn: () => Promise<{ error?: string; paymentIntentId?: string; status?: string }>) => {
            confirmRef.current = fn;
        },
        [],
    );

    const spotIdsKey = spots.map((s) => s.id).join(',');
    // Guards the init against re-runs that would mint DUPLICATE pending orders:
    // React StrictMode's double effect invoke, and the sheet being closed and
    // reopened on the same spots (the component stays mounted; the existing
    // session's PaymentIntent is still confirmable). A new spot set or an
    // explicit retry bump gets a fresh key and re-inits.
    const initKeyRef = useRef<string | null>(null);

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
        setPhase({ name: 'preparing' });
        setSession(null);
        setStripeInstance(null);

        (async () => {
            try {
                const checkoutRes = await fetch('/api/live/spots/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spotIds: spots.map((s) => s.id) }),
                });
                const checkoutData = await checkoutRes.json();
                if (!checkoutRes.ok || !checkoutData.success) {
                    throw new Error(
                        checkoutData.error || t('live.payment.startError') || 'Could not start checkout',
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
                    throw new Error(
                        piData.error || t('live.payment.startError') || 'Could not start checkout',
                    );
                }

                const account: string | null = checkoutData.sellerStripeAccount ?? null;
                const stripePromise = getStripePromise(account);
                const stripe = stripePromise ? await stripePromise : null;
                if (!stripe) throw new Error('Stripe failed to load');

                setSession({
                    transferGroup: checkoutData.transferGroup,
                    totalSatang: checkoutData.totalSatang,
                    sellerStripeAccount: account,
                    clientSecret: piData.client_secret,
                });
                setStripeInstance(stripe);
                setPhase({ name: 'ready' });
            } catch (err: any) {
                setPhase({
                    name: 'error',
                    message: err?.message || t('live.payment.startError') || 'Could not start checkout',
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
        const result = await confirm();
        if (result.error) {
            setPhase({ name: 'error', message: result.error });
            return;
        }

        const settled = result.status === 'succeeded';
        const processingAsync = result.status === 'processing';
        if (!settled && !processingAsync) {
            setPhase({
                name: 'error',
                message: `${t('live.payment.failed') || 'Payment failed'} (${result.status || 'unknown'})`,
            });
            return;
        }

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
    }, [session, onSuccess, t]);

    // Failure path: give the buyer their spots back so the board unblocks for
    // everyone else instead of pinning the hold until it expires.
    const handleRelease = useCallback(async () => {
        setReleasing(true);
        try {
            await Promise.all(
                spots.map((s) =>
                    fetch(`/api/live/spots/${s.id}/release`, { method: 'POST' }).catch(() => null),
                ),
            );
        } finally {
            setReleasing(false);
            onReleased();
        }
    }, [spots, onReleased]);

    if (!open) return null;

    const totalSatang = session?.totalSatang ?? spots.reduce((sum, s) => sum + s.priceSatang, 0);

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
                            onClick={onClose}
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
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default SpotPaymentSheet;
