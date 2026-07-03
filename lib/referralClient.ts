/**
 * Client-side half of referral attribution (browser + Capacitor WebView).
 *
 * /join/<slug> sets an httpOnly cs_ref cookie the client can't see, so the
 * shell calls the attribute endpoint blindly once per signed-in user and
 * lets the server decide. The ?ref= query param (set when /join redirects
 * into the web app) is mirrored to localStorage as a fallback slug for
 * contexts where the cookie didn't survive — e.g. the email-verification
 * link opened in a different browser.
 */

export const REF_STORAGE_KEY = 'cs_ref';
/** Client UUID identifying this Android install to /api/referrals/install. */
export const INSTALL_ID_KEY = 'cs_install_id';
/** Set once the install referrer has been reported (or found non-partner). */
export const INSTALL_REPORTED_KEY = 'cs_install_reported';

const attemptKey = (userId: string) => `cs_ref_attributed_${userId}`;

/** Call on app mount: stash ?ref=<slug> from the URL for later attribution. */
export function captureReferralParam(): void {
    try {
        const ref = new URLSearchParams(window.location.search).get('ref');
        if (ref && /^[a-z0-9-]{3,50}$/.test(ref)) {
            localStorage.setItem(REF_STORAGE_KEY, ref);
        }
    } catch {
        // Storage unavailable (private mode) — cookie path still works.
    }
}

/**
 * Call on sign-in. Fire-and-forget; the server enforces the real rules
 * (new accounts only, first attribution wins, no self-referral).
 */
export async function maybeAttributeReferral(userId: string): Promise<void> {
    try {
        if (localStorage.getItem(attemptKey(userId))) return;

        const slug = localStorage.getItem(REF_STORAGE_KEY) || undefined;
        // The install id (Android only) lets the server see that this device's
        // install already incremented total_downloads, so the signup sets
        // referred_by without counting the same person twice.
        const installId = localStorage.getItem(INSTALL_ID_KEY) || undefined;
        const res = await fetch('/api/referrals/attribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, installId }),
        });
        if (!res.ok) return; // transient failure — retry on next sign-in

        const data = await res.json().catch(() => ({}));
        // 'no_referral' means there was nothing to attribute yet — leave the
        // door open in case a referral cookie shows up within the window.
        if (data?.attributed || data?.reason !== 'no_referral') {
            localStorage.setItem(attemptKey(userId), '1');
            localStorage.removeItem(REF_STORAGE_KEY);
        }
    } catch {
        // Non-fatal — attribution just doesn't happen this session.
    }
}
