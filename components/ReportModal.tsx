import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ReportEntityType } from '@/types';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface ReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    entityType: ReportEntityType;
    entityId: string;
    entityName?: string;
}

const REPORT_REASONS = [
    "Inappropriate content or language",
    "Counterfeit or fake item",
    "Misleading description",
    "Prohibited item",
    "Scam or fraudulent activity",
    "Other"
];

const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, entityType, entityId, entityName }) => {
    const { t } = useTranslation();
    const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0]);
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const REASON_KEYS: Record<string, string> = {
        "Inappropriate content or language": "inappropriateContent",
        "Counterfeit or fake item": "counterfeit",
        "Misleading description": "misleading",
        "Prohibited item": "prohibited",
        "Scam or fraudulent activity": "scam",
        "Other": "other"
    };

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setErrorMessage('');
        
        try {
            const supabase = createClient();
            const { data: userData, error: userError } = await supabase.auth.getUser();
            
            if (userError || !userData.user) {
                setErrorMessage(t('report.loginRequired'));
                setIsSubmitting(false);
                return;
            }

            const { error: insertError } = await supabase.from('reports').insert({
                reporter_id: userData.user.id,
                entity_type: entityType,
                entity_id: entityId,
                entity_name: entityName,
                reason: selectedReason,
                description: description.trim()
            });

            if (insertError) {
                console.error("Report insertion failed:", insertError);
                setErrorMessage(t('report.failed'));
            } else {
                setSuccessMessage(t('report.successMessage'));
                setTimeout(() => {
                    setSuccessMessage('');
                    onClose();
                }, 2000);
            }
        } catch (err) {
            console.error(err);
            setErrorMessage(t('report.error'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md glass border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-scaleIn">
                <div className="p-6 border-b border-white/5">
                    <h3 className="text-xl font-black text-white italic skew-x-[-5deg]">
                        {entityType === 'seller' ? t('report.reportSeller') : t('report.reportListing')}
                    </h3>
                    {entityName && (
                        <p className="text-sm text-slate-400 mt-1 truncate">{t('report.target')}: {entityName}</p>
                    )}
                </div>

                {successMessage ? (
                    <div className="p-8 text-center flex flex-col items-center justify-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-brand-green/20 flex items-center justify-center border border-brand-green/40">
                            <i className="fa-solid fa-check text-2xl text-brand-green"></i>
                        </div>
                        <p className="font-bold text-white text-sm">{successMessage}</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-6 space-y-5">
                        {errorMessage && (
                            <div className="text-xs font-bold text-brand-red bg-brand-red/10 p-3 rounded-lg border border-brand-red/20">
                                {errorMessage}
                            </div>
                        )}
                        
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                {t('report.reason')}
                            </label>
                            <div className="relative">
                                <select 
                                    className="w-full h-12 bg-black/40 border border-white/10 rounded-xl px-4 text-sm font-semibold text-white outline-none focus:border-brand-cyan appearance-none"
                                    value={selectedReason}
                                    onChange={(e) => setSelectedReason(e.target.value)}
                                >
                                    {REPORT_REASONS.map(reason => (
                                        <option key={reason} value={reason} className="bg-[#0f1419]">
                                            {t(`report.reasons.${REASON_KEYS[reason]}`)}
                                        </option>
                                    ))}
                                </select>
                                <i className="fa-solid fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"></i>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                {t('report.additionalDetails')}
                            </label>
                            <textarea 
                                className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-cyan resize-none"
                                placeholder={t('report.provideContext')}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                required
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button 
                                type="button"
                                onClick={onClose}
                                className="flex-1 h-12 bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-colors"
                            >
                                {t('report.cancel')}
                            </button>
                            <button 
                                type="submit"
                                disabled={isSubmitting}
                                className="flex-1 h-12 bg-brand-red text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-red-500 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                ) : (
                                    <>
                                        <i className="fa-solid fa-flag"></i> {t('report.submit')}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default ReportModal;
