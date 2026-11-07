'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import {
    disableWishlistShare,
    enableWishlistShare,
    fetchWishlistShare,
    isGiftSeason,
    type WishlistShareState,
} from '@/lib/wishlistShare';
import { trackWishlistShare, type WishlistShareChannel } from '@/lib/wishlistShareEvents';

/**
 * Share your wishlist: the trigger button and the sheet behind it, used by the
 * mobile Vault's wishlist view and the desktop Collection's Wishlist tab.
 *
 * The sheet opens on the CURRENT state (GET). No link yet shows what sharing
 * means and a Create link button, so a public link is never minted by merely
 * opening the sheet; an existing link shows the link itself, the channels and
 * Turn off link. Channels mirror ShareShowButton: the OS share sheet where it
 * exists (most Thai phones), else Copy, plus LINE / Facebook / X web intents.
 * LINE is the channel that matters in Thailand.
 *
 * The message is holiday-flavoured inside the gift season (lib/wishlistShare
 * isGiftSeason) and neutral outside it. It is the one line a loved one reads
 * before deciding to tap, so it says what the link is in plain words.
 *
 * Portalled to document.body for the same reason as ShareShowButton: the
 * hosts sit inside a `.glass` card or a framer-motion panel, either of which
 * would make `fixed inset-0` resolve to the card instead of the viewport.
 */

export function WishlistShareButton({
    className,
    label,
    cardCount,
    children,
}: {
    className?: string;
    /** Text beside the icon; omit for an icon-only button (the aria-label is still set). */
    label?: string;
    /** For analytics only: how many cards the link will show. */
    cardCount?: number;
    /** Custom contents (the seasonal strip); replaces the icon + label. */
    children?: React.ReactNode;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={className}
                aria-label={label || t('wishlistShare.button')}
                title={label || t('wishlistShare.button')}
            >
                {children ?? (
                    <>
                        <i className="fa-solid fa-share-nodes text-xs"></i>
                        {label && <span>{label}</span>}
                    </>
                )}
            </button>
            {open && <WishlistShareSheet cardCount={cardCount} onClose={close} />}
        </>
    );
}

type SheetState = 'loading' | 'error' | WishlistShareState;

export function WishlistShareSheet({ cardCount, onClose }: { cardCount?: number; onClose: () => void }) {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [state, setState] = useState<SheetState>('loading');
    const [busy, setBusy] = useState(false);

    const load = useCallback((signal?: AbortSignal) => {
        setState('loading');
        void fetchWishlistShare(signal).then((s) => {
            if (signal?.aborted) return;
            setState(s ?? 'error');
        });
    }, []);

    useEffect(() => {
        const ctrl = new AbortController();
        load(ctrl.signal);
        return () => ctrl.abort();
    }, [load]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const current = typeof state === 'object' ? state : null;
    const enabled = !!current?.enabled && !!current.path;
    const path = enabled ? current!.path! : '';

    // Built from the live origin, never a constant: the same component runs on
    // cardstreet.app, on localhost and inside the app WebView.
    const absoluteUrl = () => `${window.location.origin}${path}`;
    const message = () => t(isGiftSeason() ? 'wishlistShare.messageSeason' : 'wishlistShare.message');

    const create = async () => {
        setBusy(true);
        const next = await enableWishlistShare();
        setBusy(false);
        if (!next) {
            showToast(t('wishlistShare.failed'), 'error');
            return;
        }
        setState(next);
        if (next.enabled) trackWishlistShare('wishlist_share_link', { cards: cardCount });
    };

    const turnOff = async () => {
        setBusy(true);
        const ok = await disableWishlistShare();
        setBusy(false);
        if (!ok) {
            showToast(t('wishlistShare.failed'), 'error');
            return;
        }
        setState({ available: true, enabled: false, token: null, path: null });
        showToast(t('wishlistShare.turnedOff'), 'success');
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(`${message()}\n${absoluteUrl()}`);
            showToast(t('wishlistShare.copied'), 'success');
            trackWishlistShare('wishlist_share', { channel: 'copy' });
        } catch {
            showToast(t('wishlistShare.copyError'), 'error');
        }
    };

    const systemShare = async () => {
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title: t('wishlistShare.sheetTitle'), text: message(), url: absoluteUrl() });
                trackWishlistShare('wishlist_share', { channel: 'system' });
                return;
            } catch (err) {
                // Abort = the user closed the OS sheet. Anything else falls through to copy.
                if (err instanceof Error && err.name === 'AbortError') return;
            }
        }
        await copy();
    };

    const openIntent = (channel: WishlistShareChannel, build: (url: string, text: string) => string) => {
        window.open(build(absoluteUrl(), message()), '_blank', 'noopener,noreferrer');
        trackWishlistShare('wishlist_share', { channel });
    };

    const rowCls =
        'w-full h-11 rounded-xl bg-white/5 border border-white/10 px-3 flex items-center gap-2.5 text-xs font-bold text-slate-200 hover:bg-white/10 active:scale-[0.98] transition-all disabled:opacity-50';
    const primaryCls =
        'w-full h-12 rounded-xl bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50';

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={t('wishlistShare.sheetTitle')}
        >
            <div
                className="w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-slate-900 rounded-2xl border border-white/10 p-4 space-y-3"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t('wishlistShare.sheetTitle')}</p>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('wishlistShare.close')}
                        className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-400"
                    >
                        <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>

                {state === 'loading' && (
                    <div className="space-y-2 py-2" aria-busy="true">
                        <div className="h-4 w-3/4 rounded bg-white/5 animate-pulse" />
                        <div className="h-4 w-1/2 rounded bg-white/5 animate-pulse" />
                        <div className="h-12 rounded-xl bg-white/5 animate-pulse" />
                    </div>
                )}

                {state === 'error' && (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">{t('wishlistShare.failed')}</p>
                        <button type="button" onClick={() => load()} className={rowCls}>
                            <i className="fa-solid fa-rotate-right w-5 text-center text-slate-400"></i>
                            {t('wishlistShare.retry')}
                        </button>
                    </div>
                )}

                {current && !current.available && <p className="text-sm text-slate-300">{t('wishlistShare.unavailable')}</p>}

                {current && current.available && !enabled && (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-200 leading-relaxed">{t('wishlistShare.intro')}</p>
                        <p className="text-xs text-slate-400 leading-relaxed">{t('wishlistShare.privacy')}</p>
                        {isGiftSeason() && (
                            <p className="text-xs text-brand-cyan leading-relaxed flex items-start gap-2">
                                <i className="fa-solid fa-gift mt-0.5"></i>
                                <span>{t('wishlistShare.seasonHint')}</span>
                            </p>
                        )}
                        <button type="button" onClick={() => void create()} disabled={busy} className={primaryCls}>
                            <i className="fa-solid fa-link text-xs"></i>
                            {busy ? t('wishlistShare.creating') : t('wishlistShare.createLink')}
                        </button>
                    </div>
                )}

                {enabled && (
                    <div className="space-y-2">
                        <p className="text-xs text-slate-400 leading-relaxed">{t('wishlistShare.linkReady')}</p>
                        <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 px-3 h-11">
                            <i className="fa-solid fa-link text-slate-500 text-xs"></i>
                            <span className="flex-1 min-w-0 truncate text-xs text-slate-200 font-mono" dir="ltr">
                                {absoluteUrl().replace(/^https?:\/\//, '')}
                            </span>
                            <button
                                type="button"
                                onClick={() => void copy()}
                                aria-label={t('wishlistShare.copyLink')}
                                title={t('wishlistShare.copyLink')}
                                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-300 hover:bg-white/10"
                            >
                                <i className="fa-solid fa-copy text-xs"></i>
                            </button>
                        </div>
                        <button type="button" onClick={() => void systemShare()} className={primaryCls}>
                            <i className="fa-solid fa-share-nodes text-xs"></i>
                            {t('wishlistShare.share')}
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                openIntent('line', (url, text) => `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`)
                            }
                            className={rowCls}
                        >
                            <i className="fa-brands fa-line w-5 text-center text-[#06c755]"></i>
                            LINE
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                openIntent(
                                    'facebook',
                                    (url, text) =>
                                        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
                                )
                            }
                            className={rowCls}
                        >
                            <i className="fa-brands fa-facebook w-5 text-center text-[#1877f2]"></i>
                            Facebook
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                openIntent(
                                    'x',
                                    (url, text) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
                                )
                            }
                            className={rowCls}
                        >
                            <i className="fa-brands fa-x-twitter w-5 text-center"></i>X
                        </button>
                        <button
                            type="button"
                            onClick={() => void turnOff()}
                            disabled={busy}
                            className="w-full h-10 rounded-xl text-xs font-bold text-brand-red/90 hover:bg-brand-red/10 transition-colors disabled:opacity-50"
                        >
                            {t('wishlistShare.turnOff')}
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
