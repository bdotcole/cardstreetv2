'use client';

import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import type { LiveStreamRow } from '@/components/live/shared';

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
 * The message is STATUS-AWARE — "LIVE now" on a scheduled show would promise
 * something the link can't deliver: live says watch now, scheduled says when
 * it starts (Bangkok wall clock — the audience is Thailand regardless of the
 * sharer's device tz) and plugs the presale when spots are reservable, ended
 * points at the seller's next show. Cancelled shares like ended.
 *
 * The absolute URL is built at click time from window.location.origin — never
 * at render — so the component stays SSR-safe wherever it's dropped.
 *
 * The sheet is PORTALLED to document.body. It must be: several call sites sit
 * inside a `.glass` card (backdrop-filter) or a framer-motion panel (transform),
 * and either one makes its element the containing block for `position: fixed`
 * descendants. Rendered in place, `fixed inset-0` then resolves to that card
 * instead of the viewport, and `items-end` bottom-aligns the ~400px sheet inside
 * a ~120px box — everything above the fold is clipped off the top, unscrollable.
 */

// Mirrors lib/locales/{en,th}.json live.share.* — the || fallbacks keep the
// button functional if a key is ever dropped from the locale files.
const MESSAGE_FALLBACKS: Record<string, string> = {
    message: 'LIVE now: {title} — watch {seller} breaking on CardStreet',
    messageNoSeller: 'LIVE now: {title} — watch live breaks on CardStreet',
    scheduled: 'Going live {when}: {title} — {seller} on CardStreet',
    scheduledNoSeller: 'Going live {when}: {title} — live breaks on CardStreet',
    scheduledPresale:
        'Going live {when}: {title} — presale open, reserve your spot with {seller} on CardStreet',
    scheduledPresaleNoSeller:
        'Going live {when}: {title} — presale open, reserve your spot on CardStreet',
    ended: '{seller} streams live breaks on CardStreet — catch the next show',
    endedNoSeller: 'Live breaks on CardStreet — catch the next show',
};

export function ShareShowButton({
    title,
    sellerName,
    path,
    status,
    scheduledAt,
    presaleOpen,
    className,
    label,
}: {
    /** Show title — the navigator.share sheet title and part of the message. */
    title: string;
    /** Seller display name woven into the share message; omit to drop it. */
    sellerName?: string | null;
    /** App-relative link to share, e.g. `/live/<id>`. */
    path: string;
    /** Show status — picks the live / scheduled / ended message variant. */
    status: LiveStreamRow['status'];
    /** Start time (ISO) for the scheduled variant; null/invalid reads "soon". */
    scheduledAt?: string | null;
    /** Scheduled shows only: spots are reservable now — plugs the presale. */
    presaleOpen?: boolean;
    /** Full styling of the trigger button (icon is appended inside). */
    className?: string;
    /** Optional text label next to the icon (row-style buttons). */
    label?: string;
}) {
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();
    const [sheetOpen, setSheetOpen] = useState(false);

    const shareUrl = useCallback(() => `${window.location.origin}${path}`, [path]);

    // Short Bangkok wall-clock form, e.g. "Sat 15 Aug, 19:00" / "ส. 15 ส.ค. 19:00".
    const formatWhen = useCallback(() => {
        const ts = scheduledAt ? Date.parse(scheduledAt) : NaN;
        if (Number.isNaN(ts)) return t('live.share.soon') || 'soon';
        return new Intl.DateTimeFormat(isThai ? 'th-TH' : 'en-GB', {
            timeZone: 'Asia/Bangkok',
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(ts);
    }, [scheduledAt, isThai, t]);

    // t() has no interpolation — the locale strings carry {title}/{seller}/
    // {when} placeholders replaced here, so word order can differ per language.
    const shareText = useCallback(() => {
        const phase = status === 'live' || status === 'scheduled' ? status : 'ended';
        const key =
            phase === 'live'
                ? sellerName
                    ? 'message'
                    : 'messageNoSeller'
                : phase === 'scheduled'
                  ? presaleOpen
                      ? sellerName
                          ? 'scheduledPresale'
                          : 'scheduledPresaleNoSeller'
                      : sellerName
                        ? 'scheduled'
                        : 'scheduledNoSeller'
                  : sellerName
                    ? 'ended'
                    : 'endedNoSeller';
        const template = t(`live.share.${key}`) || MESSAGE_FALLBACKS[key];
        return template
            .replace('{when}', phase === 'scheduled' ? formatWhen() : '')
            .replace('{title}', title)
            .replace('{seller}', sellerName ?? '');
    }, [t, status, presaleOpen, formatWhen, title, sellerName]);

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

            {sheetOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    onClick={() => setSheetOpen(false)}
                >
                    <div
                        className="w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-slate-900 rounded-2xl border border-white/10 p-4 space-y-2"
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
                </div>,
                document.body,
            )}
        </>
    );
}
