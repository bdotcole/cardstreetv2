'use client';

import { useTranslation } from '@/lib/hooks/useTranslation';
import {
    needsPayoutActionInState,
    sellerStateCopy,
    type SellerState,
} from '@/lib/sellerState';

/**
 * The one banner that tells a seller where they stand.
 *
 * Replaces three independently-derived messages that disagreed with each other
 * (see lib/sellerState.ts). The copy change is the point of it: draft-first
 * listings have been live since 20260730, so a seller without payouts CAN list
 * right now — every previous message read as a blocker, and sellers who bounced
 * off Stripe's KYC form believed they had to finish it before listing anything.
 *
 * Silent in the two states with nothing to say ('ready') or nowhere to send the
 * user ('signed_out' is handled by the surrounding auth UI on every surface
 * that renders this).
 */
export default function SellerStateBanner({
    state,
    onAction,
    busy = false,
    className = '',
}: {
    state: SellerState;
    /** Runs the state's CTA. Omit and the button is not rendered. */
    onAction?: () => void;
    busy?: boolean;
    className?: string;
}) {
    const { t } = useTranslation();
    if (state === 'ready' || state === 'signed_out') return null;

    const copy = sellerStateCopy(state);
    // Amber only where the seller has something to do. 'payouts_in_review' is
    // Stripe's turn, not theirs, and colouring it as a warning invites them to
    // hunt for a button that should not exist.
    const actionable = needsPayoutActionInState(state) || state === 'shipping_incomplete';
    const tone = actionable
        ? 'bg-amber-500/10 border-amber-500/30'
        : 'bg-brand-cyan/[0.07] border-brand-cyan/25';
    const titleTone = actionable ? 'text-amber-300' : 'text-brand-cyan';

    return (
        <div className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 ${tone} ${className}`}>
            <div className="min-w-0">
                <p className={`font-bold text-sm ${titleTone}`}>{t(copy.titleKey)}</p>
                <p className="text-slate-400 text-xs mt-0.5 leading-snug">{t(copy.bodyKey)}</p>
            </div>
            {copy.ctaKey && onAction && (
                <button
                    onClick={onAction}
                    disabled={busy}
                    className={`text-xs font-black px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 shrink-0 ${
                        actionable
                            ? 'bg-amber-400 hover:bg-amber-300 text-brand-darker'
                            : 'bg-brand-cyan hover:bg-cyan-300 text-brand-darker'
                    }`}
                >
                    {t(copy.ctaKey)}
                </button>
            )}
        </div>
    );
}
