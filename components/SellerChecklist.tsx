'use client';

import { useTranslation } from '@/lib/hooks/useTranslation';
import type { SellerState } from '@/lib/sellerState';

/**
 * Three steps to a live listing, shown after the return from Stripe.
 *
 * Coming back from hosted onboarding is the moment a seller has just done
 * something effortful and has no idea whether it worked or what is left. The
 * app said nothing: the return URL dropped them on a page whose only signal was
 * whether an amber banner had disappeared. Sellers with Stripe finished and no
 * listing were the largest cohort in the audit's seller funnel.
 *
 * Step 2 shows "in review" rather than a tick or a cross while Stripe is
 * checking, because it is neither — and because it is the step most likely to
 * be mistaken for a failure the seller has to fix.
 */

interface Step {
    done: boolean;
    /** Neither done nor actionable — waiting on someone else. */
    pending?: boolean;
    labelKey: string;
    onAction?: () => void;
    actionKey?: string;
}

export default function SellerChecklist({
    state,
    hasListing,
    onFixShipping,
    onSetupPayouts,
    onList,
    onDismiss,
}: {
    state: SellerState;
    hasListing: boolean;
    onFixShipping?: () => void;
    onSetupPayouts?: () => void;
    onList?: () => void;
    onDismiss?: () => void;
}) {
    const { t } = useTranslation();

    const shippingDone = state !== 'shipping_incomplete' && state !== 'signed_out';
    const payoutsDone = state === 'ready';
    const payoutsPending = state === 'payouts_in_review';

    const steps: Step[] = [
        {
            done: shippingDone,
            labelKey: 'sellerChecklist.shipping',
            onAction: shippingDone ? undefined : onFixShipping,
            actionKey: 'sellerState.shippingCta',
        },
        {
            done: payoutsDone,
            pending: payoutsPending,
            labelKey: payoutsPending ? 'sellerChecklist.payoutsReview' : 'sellerChecklist.payouts',
            onAction: payoutsDone || payoutsPending ? undefined : onSetupPayouts,
            actionKey: 'sellerState.payoutsCta',
        },
        {
            done: hasListing,
            labelKey: 'sellerChecklist.listing',
            onAction: hasListing ? undefined : onList,
            actionKey: 'sellerChecklist.listCta',
        },
    ];

    // Nothing to say once all three are done — a checklist of ticks is clutter.
    if (steps.every((s) => s.done)) return null;

    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-black text-white">{t('sellerChecklist.title')}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{t('sellerChecklist.body')}</p>
                </div>
                {onDismiss && (
                    <button
                        onClick={onDismiss}
                        aria-label={t('sellerChecklist.dismiss')}
                        className="shrink-0 w-6 h-6 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                )}
            </div>

            <ol className="mt-4 space-y-3">
                {steps.map((step, i) => (
                    <li key={step.labelKey} className="flex items-center gap-3">
                        <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                step.done
                                    ? 'bg-brand-green/20 text-brand-green'
                                    : step.pending
                                        ? 'bg-brand-cyan/15 text-brand-cyan'
                                        : 'bg-white/5 text-slate-500 border border-white/10'
                            }`}
                        >
                            {step.done ? <i className="fa-solid fa-check"></i> : step.pending ? <i className="fa-solid fa-hourglass-half"></i> : i + 1}
                        </span>
                        <span className={`flex-1 text-xs leading-snug ${step.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                            {t(step.labelKey)}
                        </span>
                        {step.onAction && step.actionKey && (
                            <button
                                onClick={step.onAction}
                                className="shrink-0 text-[11px] font-black text-brand-cyan hover:text-white transition-colors"
                            >
                                {t(step.actionKey)}
                            </button>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}
