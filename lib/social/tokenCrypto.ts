/**
 * At-rest encryption for social OAuth tokens (social_accounts.*_token_enc).
 *
 * A Page / channel token lets its holder read every insight the brand account
 * has and, with wider scopes, post as the brand — so it never sits in the
 * table in the clear and is never returned to a browser. Decryption happens
 * in one place: the sync (lib/social/sync.ts), server-side, to call the
 * platform.
 *
 * Same construction as lib/streamKeyCrypto.ts (AES-256-GCM, key derived from
 * a dedicated secret with the service-role key as the fallback so the feature
 * works the day it deploys), with its own domain separation so the two
 * features never share key material. Rotating the secret makes every saved
 * token undecryptable; the dashboard then shows the account as needing a
 * reconnect, which is one click per platform.
 *
 * Wire format: `v1.<iv>.<tag>.<ciphertext>` (base64url). Server-only —
 * node:crypto, never imported from a 'use client' module.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const VERSION = 'v1';

function derivedKey(): Buffer | null {
    const secret = process.env.SOCIAL_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) return null;
    return createHash('sha256').update(`cardstreet:social-token:${secret}`).digest();
}

/** Null when no secret is configured — callers refuse to save rather than store plaintext. */
export function encryptToken(plain: string): string | null {
    const key = derivedKey();
    if (!key) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/** Null on a missing secret, a foreign format, or a failed authentication tag. */
export function decryptToken(enc: string | null | undefined): string | null {
    const key = derivedKey();
    if (!key || typeof enc !== 'string') return null;
    const parts = enc.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ct = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16) return null;
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}
