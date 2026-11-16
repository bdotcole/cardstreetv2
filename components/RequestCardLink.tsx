import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * "Can't find your card? Request it": the way into the card-request form from
 * a list of search results. One full-width button, so the whole row is the
 * tap target. State lives in the host (lib/hooks/useCardRequest).
 */
const RequestCardLink: React.FC<{ onRequest: () => void; className?: string }> = ({ onRequest, className = '' }) => {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={onRequest}
            className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left rounded-xl border border-dashed border-white/15 bg-white/[0.03] hover:border-brand-cyan/40 active:bg-white/[0.06] transition-colors ${className}`}
        >
            <span className="text-xs font-bold text-slate-400 truncate">{t('cardRequest.cantFind')}</span>
            <span className="shrink-0 flex items-center gap-1.5 text-xs font-black text-brand-cyan">
                {t('cardRequest.requestIt')}
                <i className="fa-solid fa-chevron-right text-[9px]"></i>
            </span>
        </button>
    );
};

export default RequestCardLink;
