'use client';

import type React from 'react';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';

/**
 * The link between a page's Thai (bare) and English (/en) variants.
 *
 * WHY A LINK AND NOT A BUTTON: the standalone content pages (/faq, /prices,
 * /graded, /sell-cards, /terms, /privacy, /contact, /help and the breaker pair)
 * render the root layout, not app/desktop/layout.tsx, so they never got the
 * DesktopNav language control that became an <a href> on 2026-09-01. Measured
 * 2026-09-23: each of them emitted zero links into the other locale, leaving
 * hreflang as the only signal — and hreflang is a hint about a page a crawler
 * has already found, not a way to find one. A real anchor is a crawl path.
 *
 * WHY IT STILL SETS THE COOKIE ON CLICK: middleware derives cs_lang from the /en
 * prefix on the way in, but a bare-path navigation keeps whatever cookie the
 * visitor already has. Without updateLanguage, going /en/prices -> /prices would
 * render English copy under the Thai canonical URL — the address bar, the
 * canonical and the UI language would disagree, which is the exact state the
 * URL-locale scheme exists to prevent. Same reasoning as DesktopNav's toggle.
 *
 * `prefix` is the URL prefix the server page resolved from requestPathLocale()
 * ('' or '/en'), never the cookie, so the href always points at the OTHER
 * variant of the URL actually being served. `path` is the page's bare route.
 */
export default function LocaleSwitchLink({
    prefix,
    path,
    className,
    label,
}: {
    prefix: string;
    path: string;
    className?: string;
    /** Visible text; defaults to the current locale code, like DesktopNav. */
    label?: React.ReactNode;
}) {
    const { updateLanguage } = useUserSettings();
    const isEn = prefix === '/en';
    const bare = path === '/' ? '' : path;
    const href = isEn ? bare || '/' : `/en${bare}`;
    const next = isEn ? 'TH' : 'EN';

    const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
        // Plain left-click only: let modifier/middle clicks open the href as-is.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        try {
            await updateLanguage(next);
        } catch {
            // The navigation still carries the locale in the URL; middleware
            // sets the cookie from the /en prefix on the way in.
        }
        window.location.assign(href);
    };

    return (
        <a
            href={href}
            hrefLang={isEn ? 'th' : 'en'}
            onClick={onClick}
            title={isEn ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'}
            aria-label={isEn ? 'Switch to Thai' : 'Switch to English'}
            className={
                className ??
                'ml-auto shrink-0 w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center text-[11px] font-black text-slate-300 hover:text-white transition-colors'
            }
        >
            {label ?? (isEn ? 'EN' : 'TH')}
        </a>
    );
}
