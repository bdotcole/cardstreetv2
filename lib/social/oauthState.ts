/**
 * Signed OAuth `state` for the admin "Connect" flows.
 *
 * The state carries which brand the admin was connecting for and who they
 * are, and is HMAC-signed so the callback can trust it without a server-side
 * session store. A copy rides in a short-lived cookie too, so a callback with
 * a state we did not mint (or that was minted for a different browser) is
 * refused — the CSRF protection OAuth expects of the `state` parameter.
 *
 * Server-only (node:crypto).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { SocialBrand, SocialPlatform } from './types';

export const OAUTH_STATE_COOKIE = 'cs_social_oauth_state';
const TTL_MS = 15 * 60_000;

export interface OAuthStatePayload {
    brand: SocialBrand;
    platform: SocialPlatform;
    adminId: string;
    nonce: string;
    exp: number;
}

function secret(): string | null {
    return process.env.SOCIAL_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(body: string): string | null {
    const s = secret();
    if (!s) return null;
    return createHmac('sha256', `cardstreet:social-oauth-state:${s}`).update(body).digest('base64url');
}

export function mintOAuthState(input: Omit<OAuthStatePayload, 'nonce' | 'exp'>): string | null {
    const payload: OAuthStatePayload = {
        ...input,
        nonce: randomBytes(12).toString('base64url'),
        exp: Date.now() + TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = sign(body);
    return sig ? `${body}.${sig}` : null;
}

/** Null when the signature, shape or expiry fails. */
export function verifyOAuthState(state: string | null | undefined): OAuthStatePayload | null {
    if (!state || typeof state !== 'string') return null;
    const dot = state.lastIndexOf('.');
    if (dot < 0) return null;
    const body = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = sign(body);
    if (!expected) return null;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
        if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
        if (!payload.brand || !payload.platform || !payload.adminId) return null;
        return payload;
    } catch {
        return null;
    }
}
