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
 * Call once on app mount. No-op outside the Android native shell, after a
 * successful report, or on shell builds that predate the plugin.
 */
export async function maybeReportInstallReferrer(): Promise<void> {
    try {
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
        if (localStorage.getItem(INSTALL_REPORTED_KEY)) return;

        // Plugin missing (pre-referrer shell build) rejects here: return WITHOUT
        // marking reported, so an app update can still credit this install.
        const { referrer } = await InstallReferrer.getReferrer();
        if (!referrer) return;

        const params = new URLSearchParams(referrer);
        const slug = params.get('utm_content');
        if (params.get('utm_source') !== 'partner' || !slug || !SLUG_PATTERN.test(slug)) {
            // Organic or non-partner install — permanently nothing to credit.
            localStorage.setItem(INSTALL_REPORTED_KEY, '1');
            return;
        }

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
        if (!res.ok) return; // transient (or rate-limited) — retry next launch

        // Counted, duplicate, or dead slug — all terminal states.
        localStorage.setItem(INSTALL_REPORTED_KEY, '1');
        localStorage.setItem(REF_STORAGE_KEY, slug);
    } catch {
        // Best-effort: referral credit must never break app boot.
    }
}
