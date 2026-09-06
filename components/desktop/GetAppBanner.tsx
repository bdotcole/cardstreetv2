'use client';

import { useEffect, useState } from 'react';
import { PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/lib/appLinks';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * "Get the app" bar, shown only below the `lg` breakpoint.
 *
 * The public content pages (card / set / seller / game landings) are served
 * from the desktop tree to phones too — deliberately, since that is what made
 * the catalog visible to Google's mobile-first crawler. The side effect is that
 * a phone visitor arriving from search lands on a web page with no route into
 * the native app, which is where scanning, the vault and push notifications
 * live. Above `lg` the footer links are enough; below it, the reader is holding
 * the device the app installs on.
 *
 * Dismissal is per-browser and permanent (localStorage). It must never nag: a
 * banner that returns after being dismissed is worse than no banner.
 */

const DISMISS_KEY = 'cs_get_app_banner_dismissed';

export default function GetAppBanner() {
    const { language } = useTranslation();
    // Starts hidden and is only shown after the storage read, so a dismissed
    // banner never flashes on during hydration.
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        try {
            if (localStorage.getItem(DISMISS_KEY) !== '1') setVisible(true);
        } catch {
            // Private mode / storage blocked: show it. An un-dismissable banner
            // is bad, but a silently missing download path is what this fixes.
            setVisible(true);
        }
    }, []);

    // Native shell: the app IS the app. Its WebView UA carries the marker
    // middleware.ts keys on, so the same string identifies it here.
    const inApp =
        typeof navigator !== 'undefined' && navigator.userAgent.includes('CardStreetApp');

    if (!visible || inApp) return null;

    const isThai = language === 'TH';
    const dismiss = () => {
        setVisible(false);
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* stays dismissed for this page only */ }
    };

    // Android is listed first: it is the platform the Thai market is
    // overwhelmingly on. Both are shown rather than a UA guess, because an
    // iPhone visitor sent to a Play Store page is a dead end.
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

    return (
        <div className="lg:hidden border-b border-white/5 bg-brand-cyan/[0.07]">
            <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-3">
                <i className="fa-solid fa-mobile-screen text-brand-cyan text-sm shrink-0"></i>
                <p className="flex-1 min-w-0 text-[11px] leading-snug text-slate-300">
                    <span className="font-bold text-white">
                        {isThai ? 'สแกนการ์ดด้วยแอป CardStreet' : 'Scan cards with the CardStreet app'}
                    </span>
                    <span className="block text-slate-400">
                        {isThai ? 'เช็คราคา เก็บคอลเลกชัน แจ้งเตือนเมื่อมีการ์ดที่คุณตามหา' : 'Check prices, track your collection, get alerts on cards you want.'}
                    </span>
                </p>
                {/* The other platform's link is kept for the (common) case of a
                    misreported UA — it just isn't the primary button. */}
                {!isIos && (
                    <a
                        href={PLAY_STORE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-cyan text-brand-darker text-[11px] font-black"
                    >
                        {isThai ? 'ติดตั้ง' : 'Install'}
                    </a>
                )}
                {!isAndroid && (
                    <a
                        href={IOS_APP_STORE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-black ${
                            isIos ? 'bg-brand-cyan text-brand-darker' : 'bg-white/10 text-slate-200'
                        }`}
                    >
                        {isIos ? (isThai ? 'ติดตั้ง' : 'Install') : 'iOS'}
                    </a>
                )}
                <button
                    onClick={dismiss}
                    aria-label={isThai ? 'ปิด' : 'Dismiss'}
                    className="shrink-0 w-7 h-7 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                >
                    <i className="fa-solid fa-xmark text-xs"></i>
                </button>
            </div>
        </div>
    );
}
