/**
 * Signed one-click unsubscribe tokens for emailed blasts.
 *
 * An unsubscribe link has to work from an inbox, which means it cannot require
 * a session — the person clicking it is frequently not signed in on that
 * device, and making them log in to stop receiving mail is exactly the
 * friction that produces spam complaints instead of unsubscribes.
 *
 * The token is therefore the authorization: an HMAC over `scope:userId`. What
 * it can do is deliberately tiny — turn ONE named preference OFF for ONE user.
 * It cannot turn anything on (see the route), cannot read anything, and does
 * not contain or reveal the recipient's address. A leaked token costs its
 * owner nothing worse than an unsubscribe they can reverse in Settings.
 *
 * NO EXPIRY, on purpose. People unsubscribe from months-old mail sitting in an
 * archive, and an expired unsubscribe link is worse than no link at all — it
 * converts an opt-out into a spam report. Rotating SUPABASE_SERVICE_ROLE_KEY
 * invalidates every outstanding token; that is an acceptable cost of a
 * rotation, and Settings remains the durable path.
 *
 * KEY CHOICE: SUPABASE_SERVICE_ROLE_KEY is server-only, already required
 * anywhere mail is sent, and never reaches the browser — so the link needs no
 * new env var. That matters: this codebase has repeatedly shipped features
 * that sat inert waiting for a Vercel variable to be pasted in. The key is
 * used only as HMAC material and is never derivable from a token.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Preferences an emailed link may switch off. Allowlisted rather than free
 * text so a forged scope can never name an arbitrary column — the value is
 * interpolated into an update payload.
 */
export const UNSUBSCRIBE_SCOPES = ['show_live_email'] as const;
export type UnsubscribeScope = (typeof UNSUBSCRIBE_SCOPES)[number];

function isScope(value: string): value is UnsubscribeScope {
    return (UNSUBSCRIBE_SCOPES as readonly string[]).includes(value);
}

function hmacKey(): string | null {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(payload: string, key: string): string {
    return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * `<base64url(scope:userId)>.<sig>`. Returns null when no key is configured,
 * so a caller can omit the link rather than emit one that can never verify.
 */
export function signUnsubscribeToken(
    userId: string,
    scope: UnsubscribeScope,
): string | null {
    const key = hmacKey();
    if (!key) return null;
    const payload = `${scope}:${userId}`;
    return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, key)}`;
}

/** Reverses signUnsubscribeToken. Null on any tampering, malformed input, or missing key. */
export function verifyUnsubscribeToken(
    token: string,
): { userId: string; scope: UnsubscribeScope } | null {
    const key = hmacKey();
    if (!key || typeof token !== 'string') return null;

    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    const [encoded, sig] = [token.slice(0, dot), token.slice(dot + 1)];

    let payload: string;
    try {
        payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        return null;
    }

    // Constant-time: a timing oracle on the signature would let a token be
    // forged byte by byte. Length is compared first because timingSafeEqual
    // throws on a mismatch.
    const expected = Buffer.from(sign(payload, key), 'utf8');
    const actual = Buffer.from(sig, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const sep = payload.indexOf(':');
    if (sep <= 0) return null;
    const scope = payload.slice(0, sep);
    const userId = payload.slice(sep + 1);
    if (!isScope(scope) || !/^[0-9a-f-]{36}$/i.test(userId)) return null;

    return { userId, scope };
}

/** The link that goes in the email. Null when the token can't be signed. */
export function unsubscribeUrl(
    baseUrl: string,
    userId: string,
    scope: UnsubscribeScope,
): string | null {
    const token = signUnsubscribeToken(userId, scope);
    return token ? `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}` : null;
}
