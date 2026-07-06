'use client';

/**
 * Android install-referrer reporting — the Android half of partner download
 * credit (iOS is credited at QR-scan time via the store_visit proxy in
 * /join/[slug], since Apple exposes no install referrer).
 *
 * Flow: /join/<slug> sends Android phones to the Play Store with
 * referrer=utm_source=partner&utm_content=<slug>. After install, the native
 * InstallReferrer plugin (android/.../InstallReferrerPlugin.java) hands that
 * string back to this web layer, which posts it once to /api/referrals/install
 * — logging a confirmed 'install' event and bumping the partner's
 * total_downloads (the tier metric).
 *
 * The install id is a client UUID persisted BEFORE the first post, so retries
 * after a network failure reuse it and the server's unique index dedupes.
 * The slug is also seeded into the cs_ref localStorage fallback so a signup
 * on this device sets referred_by; the attribute endpoint sees the same
 * install id and skips the second increment (one human, one download).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import {
    REF_STORAGE_KEY,
    INSTALL_ID_KEY,
    INSTALL_REPORTED_KEY,
} from '@/lib/referralClient';

interface InstallReferrerPlugin {
    getReferrer(): Promise<{ referrer?: string | null }>;
}

// On web / iOS this proxy rejects with "not implemented"; only ever called
// behind the android guard below, and caught regardless.
const InstallReferrer = registerPlugin<InstallReferrerPlugin>('InstallReferrer');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * Call once on app mount. No-op outside the Android native shell or on shell
 * builds that predate the plugin.
 *
 * Returns the partner slug this install should be attributed to (seeded into
 * cs_ref for the signup attribution path), or null when there's nothing to
 * credit. The caller uses the return value to re-attempt attribution for an
 * already-signed-in user, since this report can resolve *after* the initial
 * session restore already ran attribution slug-less.
 */
export async function maybeReportInstallReferrer(): Promise<string | null> {
    try {
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
        if (localStorage.getItem(INSTALL_REPORTED_KEY)) {
            // Already counted this install on an earlier launch, which also seeded
            // cs_ref. If a signup still hasn't consumed it, hand it back so this
            // session can finish attributing; once attribution succeeds it clears
            // cs_ref and this returns null.
            return localStorage.getItem(REF_STORAGE_KEY);
        }

        // Plugin missing (pre-referrer shell build) rejects here: return WITHOUT
        // marking reported, so an app update can still credit this install.
        const { referrer } = await InstallReferrer.getReferrer();
        if (!referrer) return null;

        const params = new URLSearchParams(referrer);
        const slug = params.get('utm_content');
        if (params.get('utm_source') !== 'partner' || !slug || !SLUG_PATTERN.test(slug)) {
            // Organic or non-partner install — permanently nothing to credit.
            localStorage.setItem(INSTALL_REPORTED_KEY, '1');
            return null;
        }

        // Seed the attribution slug BEFORE the network post, not after. The
        // signup that credits this install races this report; if cs_ref were
        // only written on a successful POST, the first attribute attempt (fired
        // by the session restore in app/page.tsx) would run slug-less and
        // silently no-op, and nothing would re-attempt until a later cold open
        // — often past the 7-day attribution window. Writing it now makes the
        // slug available the instant the referrer is known.
        localStorage.setItem(REF_STORAGE_KEY, slug);

        // Persist the id before posting so a retry can't mint a second one.
        let installId = localStorage.getItem(INSTALL_ID_KEY);
        if (!installId) {
            installId = crypto.randomUUID();
            localStorage.setItem(INSTALL_ID_KEY, installId);
        }

        const res = await fetch('/api/referrals/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, installId }),
        });
        // Transient (or rate-limited): leave INSTALL_REPORTED_KEY unset so a
        // later launch retries the count. cs_ref is already seeded, so signup
        // attribution can still proceed independently of the download count.
        if (!res.ok) return slug;

        // Counted, duplicate, or dead slug — all terminal states for the count.
        localStorage.setItem(INSTALL_REPORTED_KEY, '1');
        return slug;
    } catch {
        // Best-effort: referral credit must never break app boot.
        return null;
    }
}
