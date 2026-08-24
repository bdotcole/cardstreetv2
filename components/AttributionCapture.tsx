'use client';

/**
 * Records where a visitor first arrived from, so that a signup can later be
 * credited to the channel that produced it.
 *
 * Mounted in the ROOT layout, not in the two shells. The shells miss exactly the
 * pages that matter most here — /prices, /graded, /sell-cards and /faq are
 * standalone routes outside both the mobile SPA and the desktop tree, and they
 * are precisely the SEO landing pages an organic visitor hits first.
 *
 * Writes once and then leaves the cookie alone for its lifetime: this is FIRST
 * touch. Overwriting on each visit would record the last thing a user clicked
 * before signing up, which is usually Direct, and would credit SEO with nothing
 * for the visit that actually did the work.
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import {
    ATTRIBUTION_COOKIE,
    ATTRIBUTION_MAX_AGE_SECONDS,
    buildAttribution,
    serializeAttribution,
} from '@/lib/attribution';

export default function AttributionCapture() {
    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        try {
            // Already recorded — first touch stands.
            if (document.cookie.split('; ').some((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`))) {
                return;
            }

            const record = buildAttribution(window.location.href, document.referrer || '');
            if (!record) return;

            // Not httpOnly, deliberately: the OAuth callback reads this cookie
            // server-side, and a Set-Cookie from here is the simplest way to get
            // it there. It holds no secret — only which channel sent the visit.
            // SameSite=Lax so it survives the return leg of the OAuth redirect.
            const secure = window.location.protocol === 'https:' ? '; Secure' : '';
            document.cookie =
                `${ATTRIBUTION_COOKIE}=${serializeAttribution(record)}` +
                `; path=/; max-age=${ATTRIBUTION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
        } catch {
            // Cookies disabled, storage partitioned, quota — attribution is
            // best-effort and must never interfere with the page.
        }
    }, []);

    return null;
}
