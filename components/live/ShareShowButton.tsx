'use client';

import React, { useCallback, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';

/**
 * Share a show's public /live/[id] link. One trigger button, two behaviors:
 * navigator.share (the OS sheet) where available — most Thai phones — else a
 * small in-app sheet with Copy link + Facebook / X / LINE web-share intents.
 * LINE is the Thailand-critical channel. Instagram has NO web prefill API, so
 * its entry only copies the message (the tooltip/note says so).
 *
 * Every channel carries a bilingual MESSAGE (show title + seller name,
 * language from the current UI locale via useTranslation), not a bare URL:
 * navigator.share gets {title, text, url}; X gets text+url; LINE's
 * line.me/R/share carries text+url in one param; copy puts "text\nurl" on
 * the clipboard. Facebook's sharer ignores prefilled text by policy — the
 * quote= param rides along best-effort.
 *
 * The absolute URL is built at click time from window.location.origin — never
 * at render — so the component stays SSR-safe wherever it's dropped.
 */

export function ShareShowButton({
    title,
    sellerName,
    path,
    className,
    label,
}: {
    /** Show title — the navigator.share sheet title and part of the message. */
    title: string;
    /** Seller display name woven into the share message; omit to drop it. */
    sellerName?: string | null;
    /** App-relative link to share, e.g. `/live/<id>`. */
    path: string;
    /** Full styling of the trigger button (icon is appended inside). */
    className?: string;
    /** Optional text label next to the icon (row-style buttons). */
    label?: string;
}) {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [sheetOpen, setSheetOpen] = useState(false);

    const shareUrl = useCallback(() => `${window.location.origin}${path}`, [path]);

    // t() has no interpolation — the locale strings carry {title}/{seller}
    // placeholders replaced here, so word order can differ per language.
    const shareText = useCallback(() => {
        const template = sellerName
            ? t('live.share.message') ||
              'LIVE now: {title} — watch {seller} breaking on CardStreet'
            : t('live.share.messageNoSeller') ||
              'LIVE now: {title} — watch live breaks on CardStreet';
        return template.replace('{title}', title).replace('{seller}', sellerName ?? '');
    }, [t, title, sellerName]);

    const copyShare = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(`${shareText()}\n${shareUrl()}`);
            showToast(t('live.share.copied') || 'Link copied', 'success');
        } catch {
            showToast(t('live.console.copyError') || 'Could not copy the link', 'error');
        }
    }, [shareText, shareUrl, showToast, t]);

    const onShare = useCallback(async () => {
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title, text: shareText(), url: shareUrl() });
                return;
            } catch (err) {
                // Abort = the user closed the OS sheet; anything else falls
                // through to the in-app sheet so sharing never dead-ends.
                if (err instanceof Error && err.name === 'AbortError') return;
            }
        }
        setSheetOpen(true);
    }, [title, shareText, shareUrl]);

    const openIntent = useCallback(
        (build: (url: string, text: string) => string) => {
            window.open(build(shareUrl(), shareText()), '_blank', 'noopener,noreferrer');
            setSheetOpen(false);
        },
        [shareUrl, shareText],
    );

    const rowCls =
        'w-full h-11 rounded-xl bg-white/5 border border-white/10 px-3 flex items-center gap-2.5 text-xs font-bold text-slate-200 active:scale-[0.98] transition-all';

    return (
        <>
            <button
                onClick={() => void onShare()}
                aria-label={t('live.share.button') || 'Share'}
                title={t('live.share.button') || 'Share'}
                className={className}
            >
                <i className="fa-solid fa-share-nodes text-xs"></i>
                {label && <span>{label}</span>}
            </button>

            {sheetOpen && (
                <div
                    className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    onClick={() => setSheetOpen(false)}
                >
                    <div
                        className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 p-4 space-y-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                                {t('live.share.sheetTitle') || 'Share this show'}
                            </p>
                            <button
                                onClick={() => setSheetOpen(false)}
                                aria-label={t('live.payment.close') || 'Close'}
                                className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-400"
                            >
                                <i className="fa-solid fa-xmark text-sm"></i>
                            </button>
                        </div>
                        <button
                            onClick={() => {
                                void copyShare();
                                setSheetOpen(false);
                            }}
                            className={rowCls}
                        >
                            <i className="fa-solid fa-copy w-5 text-center text-slate-400"></i>
                            {t('live.share.copyLink') || 'Copy link'}
                        </button>
                        <button
                            onClick={() =>
                                openIntent((url, text) =>
                                    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
                                )
                            }
                            className={rowCls}
                        >
                            <i className="fa-brands fa-facebook w-5 text-center text-[#1877f2]"></i>
                            Facebook
                        </button>
                        <button
                            onClick={() =>
                                openIntent((url, text) =>
                                    `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
                                )
                            }
                            className={rowCls}
                        >
                            <i className="fa-brands fa-x-twitter w-5 text-center"></i>
                            X
                        </button>
                        <button
                            onClick={() =>
                                openIntent((url, text) =>
                                    `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`,
                                )
                            }
                            className={rowCls}
                        >
                            <i className="fa-brands fa-line w-5 text-center text-[#06c755]"></i>
                            LINE
                        </button>
                        <button
                            onClick={() => {
                                void copyShare();
                                setSheetOpen(false);
                            }}
                            title={t('live.share.instagramNote') || ''}
                            className={rowCls}
                        >
                            <i className="fa-brands fa-instagram w-5 text-center text-[#e1306c]"></i>
                            Instagram
                        </button>
                        <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
                            {t('live.share.instagramNote') ||
                                'Instagram does not support link prefill from the web — the link is copied, paste it into your story or bio.'}
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}
