/**
 * HMAC-signed tokens for short-lived label URLs.
 *
 * Why this exists: Capacitor's iOS WKWebView can't render PDFs natively
 * without a custom UIDelegate, so we hand the PDF off to Safari View
 * Controller via the Capacitor Browser plugin. SVC has its own cookie jar
 * separate from the webview, so the URL we open has to authenticate itself
 * without cookies. We sign (orderId, exp) with a server secret and verify
 * server-side.
 *
 * Scope: short-lived, single-resource (one URL = one orderId, expires in
 * minutes). Not a session token.
 */

import crypto from 'crypto';

function getSigningSecret(): string {
    // Dedicated secret. Previously reused CRON_SECRET, which meant one leak
    // compromised two unrelated trust boundaries (cron auth + label URLs).
    const s = process.env.LABEL_SIGNING_SECRET;
    if (!s) {
        throw new Error(
            '[labelToken] LABEL_SIGNING_SECRET is not configured — signed label URLs ' +
            'cannot be issued. Set it in Vercel (a long random string, distinct from ' +
            'CRON_SECRET) and redeploy.'
        );
    }
    return s.trim();
}

export function signLabelToken(orderId: string, expEpochSeconds: number): string {
    return crypto
        .createHmac('sha256', getSigningSecret())
        .update(`${orderId}.${expEpochSeconds}`)
        .digest('hex');
}

export function verifyLabelToken(
    orderId: string,
    expEpochSeconds: number,
    sig: string
): boolean {
    if (!sig || !orderId || !Number.isFinite(expEpochSeconds)) return false;
    if (Math.floor(Date.now() / 1000) > expEpochSeconds) return false;

    let expected: string;
    try {
        expected = signLabelToken(orderId, expEpochSeconds);
    } catch {
        return false; // Secret missing — fail closed
    }

    if (expected.length !== sig.length) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(expected, 'hex'),
            Buffer.from(sig, 'hex')
        );
    } catch {
        return false;
    }
}
