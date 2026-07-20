import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { pokemonService } from '@/services/pokemonService';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { Card } from '@/types';
import {
    GAMES,
    DEFAULT_GAME,
    getGame,
    getGameLanguages,
    gameHasMultipleLanguages,
    defaultLanguageForGame,
    type GameId,
    type GameLanguageCode,
} from '@/lib/games';

interface RequestCardModalProps {
    isOpen: boolean;
    onClose: () => void;
    // The search text that returned no matches — prefilled and editable
    initialQuery: string;
    // When the "did you mean" lookup surfaces the card the user was after,
    // tapping it hands the card back instead of filing a request.
    onFoundCard?: (card: Card) => void;
}

// Only offer games that are actually live in the catalog.
const SELECTABLE_GAMES = GAMES.filter((g) => g.enabled);

// PostgREST reports an insert against a not-yet-migrated column as PGRST204
// ("Could not find the 'game' column ... in the schema cache"); Postgres itself
// uses 42703 (undefined_column). Detect either so the form degrades gracefully
// before the migration lands rather than dead-ending the user.
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false;
    return err.code === 'PGRST204' || err.code === '42703' || /column/i.test(err.message ?? '');
}

const RequestCardModal: React.FC<RequestCardModalProps> = ({ isOpen, onClose, initialQuery, onFoundCard }) => {
    const { t, language } = useTranslation();
    const [gameId, setGameId] = useState<GameId>(DEFAULT_GAME);
    const [cardLanguage, setCardLanguage] = useState<GameLanguageCode | ''>('');
    const [cardName, setCardName] = useState(initialQuery);
    const [cardNumber, setCardNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [candidates, setCandidates] = useState<Card[]>([]);
    // Monotonic id guards against a slow earlier lookup overwriting a newer one.
    const lookupSeq = useRef(0);

    const gameLanguages = getGameLanguages(gameId);
    const needsLanguage = gameHasMultipleLanguages(gameId);

    // "Did you mean" lookup: most requests turn out to be catalog search misses
    // (spelling variants, missing V/VSTAR suffixes), and nearly all carry a
    // collector number that pinpoints the card. Surface likely matches before
    // the user files a request.
    useEffect(() => {
        if (!isOpen) return;
        const name = cardName.trim();
        const number = cardNumber.trim();
        if (!name && !number) {
            setCandidates([]);
            return;
        }
        const seq = ++lookupSeq.current;
        const timer = setTimeout(async () => {
            const effectiveLanguage = needsLanguage ? cardLanguage : defaultLanguageForGame(gameId);
            const found = await pokemonService.findRequestCandidates(name, number, effectiveLanguage || '', gameId);
            if (seq === lookupSeq.current) setCandidates(found);
        }, 400);
        return () => clearTimeout(timer);
    }, [isOpen, cardName, cardNumber, gameId, cardLanguage, needsLanguage]);

    // The modal stays mounted (returns null when closed), so seed the form
    // from the latest search query each time it opens rather than only at mount.
    useEffect(() => {
        if (isOpen) {
            setGameId(DEFAULT_GAME);
            // Pre-select the current UI locale when the default game offers it,
            // otherwise force an explicit pick for multi-language games.
            const defaultGameLangs = getGameLanguages(DEFAULT_GAME).map((l) => l.code);
            setCardLanguage(
                defaultGameLangs.includes(language as GameLanguageCode)
                    ? (language as GameLanguageCode)
                    : '',
            );
            setCardName(initialQuery);
            setCardNumber('');
            setNotes('');
            setErrorMessage('');
            setCandidates([]);
        }
    }, [isOpen, initialQuery, language]);

    // When the game changes, reset the language: single-language games don't show
    // the selector, so seed their only code; multi-language games force a pick.
    const handleGameChange = (next: GameId) => {
        setGameId(next);
        setCardLanguage(gameHasMultipleLanguages(next) ? '' : defaultLanguageForGame(next));
    };

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setErrorMessage('');

        // Multi-language games require an explicit language; single-language games
        // resolve to their only code so the request still records one.
        const effectiveLanguage: GameLanguageCode = needsLanguage
            ? (cardLanguage as GameLanguageCode)
            : defaultLanguageForGame(gameId);

        if (needsLanguage && !cardLanguage) {
            setErrorMessage(t('cardRequest.languageRequired'));
            setIsSubmitting(false);
            return;
        }

        try {
            const supabase = createClient();
            const { data: userData, error: userError } = await supabase.auth.getUser();

            if (userError || !userData.user) {
                setErrorMessage(t('cardRequest.loginRequired'));
                setIsSubmitting(false);
                return;
            }

            const requesterId = userData.user.id;
            const trimmedNumber = cardNumber.trim();
            const trimmedNotes = notes.trim();

            let { error: insertError } = await supabase.from('card_requests').insert({
                requester_id: requesterId,
                search_query: cardName.trim(),
                game: gameId,
                card_number: trimmedNumber || null,
                language: effectiveLanguage,
                notes: trimmedNotes || null,
            });

            // Graceful fallback if the game/card_number columns aren't migrated
            // yet: fold them into notes so no request (or its data) is lost.
            if (insertError && isMissingColumnError(insertError)) {
                const foldedNotes = [
                    `Game: ${getGame(gameId).name}`,
                    trimmedNumber ? `Number: ${trimmedNumber}` : null,
                    trimmedNotes || null,
                ]
                    .filter(Boolean)
                    .join('\n');
                ({ error: insertError } = await supabase.from('card_requests').insert({
                    requester_id: requesterId,
                    search_query: cardName.trim(),
                    language: effectiveLanguage,
                    notes: foldedNotes || null,
                }));
            }

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

    const selectClass =
        'w-full h-12 bg-black/40 border border-white/10 rounded-xl pl-4 pr-10 text-sm text-white outline-none focus:border-brand-cyan appearance-none cursor-pointer';

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
                    <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                        {errorMessage && (
                            <div className="text-xs font-bold text-brand-red bg-brand-red/10 p-3 rounded-lg border border-brand-red/20">
                                {errorMessage}
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                {t('cardRequest.game')}
                            </label>
                            <div className="relative">
                                <select
                                    className={selectClass}
                                    value={gameId}
                                    onChange={(e) => handleGameChange(e.target.value as GameId)}
                                    required
                                >
                                    {SELECTABLE_GAMES.map((g) => (
                                        <option key={g.id} value={g.id} className="bg-brand-darker">
                                            {g.name}
                                        </option>
                                    ))}
                                </select>
                                <i className="fa-solid fa-chevron-down text-slate-500 text-xs absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"></i>
                            </div>
                        </div>

                        {needsLanguage && (
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    {t('cardRequest.language')}
                                </label>
                                <div className="relative">
                                    <select
                                        className={selectClass}
                                        value={cardLanguage}
                                        onChange={(e) => setCardLanguage(e.target.value as GameLanguageCode)}
                                        required
                                    >
                                        <option value="" disabled className="bg-brand-darker">
                                            {t('cardRequest.languagePlaceholder')}
                                        </option>
                                        {gameLanguages.map((l) => (
                                            <option key={l.code} value={l.code} className="bg-brand-darker">
                                                {l.label}
                                            </option>
                                        ))}
                                    </select>
                                    <i className="fa-solid fa-chevron-down text-slate-500 text-xs absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"></i>
                                </div>
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
                                {t('cardRequest.cardNumber')}
                            </label>
                            <input
                                type="text"
                                className="w-full h-12 bg-black/40 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-cyan"
                                placeholder={t('cardRequest.cardNumberPlaceholder')}
                                value={cardNumber}
                                onChange={(e) => setCardNumber(e.target.value)}
                            />
                        </div>

                        {candidates.length > 0 && (
                            <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-3 space-y-2">
                                <p className="text-xs font-bold text-brand-cyan uppercase tracking-widest">
                                    {t('cardRequest.didYouMean')}
                                </p>
                                <p className="text-[11px] text-slate-400">{t('cardRequest.didYouMeanHint')}</p>
                                <div className="space-y-1.5">
                                    {candidates.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => {
                                                if (onFoundCard) {
                                                    onFoundCard(c);
                                                    onClose();
                                                }
                                            }}
                                            className={`w-full flex items-center gap-3 p-2 rounded-lg bg-black/30 border border-white/5 text-left ${onFoundCard ? 'hover:border-brand-cyan/50 transition-colors' : 'cursor-default'}`}
                                        >
                                            {c.images?.small && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={getThumbnailUrl(c.images.small)}
                                                    alt=""
                                                    className="w-9 h-13 rounded object-contain shrink-0"
                                                    loading="lazy"
                                                />
                                            )}
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-white truncate">{c.name}</p>
                                                <p className="text-[10px] text-slate-400 truncate">
                                                    {[c.set, c.number ? `#${c.number}` : null, c.rarity]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

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
                                disabled={isSubmitting || !cardName.trim() || (needsLanguage && !cardLanguage)}
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
