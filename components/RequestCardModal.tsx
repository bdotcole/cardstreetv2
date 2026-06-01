import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface RequestCardModalProps {
    isOpen: boolean;
    onClose: () => void;
    // The search text that returned no matches — prefilled and editable
    initialQuery: string;
}

const RequestCardModal: React.FC<RequestCardModalProps> = ({ isOpen, onClose, initialQuery }) => {
    const { t, language } = useTranslation();
    const [cardName, setCardName] = useState(initialQuery);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // The modal stays mounted (returns null when closed), so seed the form
    // from the latest search query each time it opens rather than only at mount.
    useEffect(() => {
        if (isOpen) {
            setCardName(initialQuery);
            setNotes('');
            setErrorMessage('');
        }
    }, [isOpen, initialQuery]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setErrorMessage('');

        try {
            const supabase = createClient();
            const { data: userData, error: userError } = await supabase.auth.getUser();

            if (userError || !userData.user) {
                setErrorMessage(t('cardRequest.loginRequired'));
                setIsSubmitting(false);
                return;
            }

            const { error: insertError } = await supabase.from('card_requests').insert({
                requester_id: userData.user.id,
                search_query: cardName.trim(),
                language,
                notes: notes.trim() || null,
            });

            if (insertError) {
                console.error('Card request insertion failed:', insertError);
                setErrorMessage(t('cardRequest.failed'));
            } else {
                setSuccessMessage(t('cardRequest.successMessage'));
                setTimeout(() => {
                    setSuccessMessage('');
                    onClose();
                }, 2000);
            }
        } catch (err) {
            console.error(err);
            setErrorMessage(t('cardRequest.failed'));
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
                        {t('cardRequest.title')}
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">{t('cardRequest.subtitle')}</p>
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
                                {t('cardRequest.cardName')}
                            </label>
                            <input
                                type="text"
                                className="w-full h-12 bg-black/40 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-cyan"
                                placeholder={t('cardRequest.cardNamePlaceholder')}
                                value={cardName}
                                onChange={(e) => setCardName(e.target.value)}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                {t('cardRequest.details')}
                            </label>
                            <textarea
                                className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-cyan resize-none"
                                placeholder={t('cardRequest.detailsPlaceholder')}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 h-12 bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-colors"
                            >
                                {t('cardRequest.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || !cardName.trim()}
                                className="flex-1 h-12 bg-brand-cyan text-brand-darker font-black text-xs uppercase tracking-widest rounded-xl hover:bg-cyan-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                ) : (
                                    <>
                                        <i className="fa-solid fa-paper-plane"></i> {t('cardRequest.submit')}
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

export default RequestCardModal;
