/**
 * At-rest encryption for social stream keys (stream_destinations.stream_key_enc).
 *
 * A stream key is a bearer credential: anyone holding it can broadcast as the
 * seller on their Facebook / YouTube / TikTok channel. It therefore never sits
 * in the table in the clear and is never returned to a browser — the console
 * gets a hint (the last characters) and that is all. Decryption happens in
 * exactly two places: go-live and a mid-show "start" (lib/streamDestinations),
 * both server-only, both to hand LiveKit the full RTMP URL.
 *
 * AES-256-GCM (authenticated — a tampered ciphertext fails to decrypt rather
 * than yielding garbage). The key is derived from LIVE_DESTINATION_SECRET when
 * set, else from SUPABASE_SERVICE_ROLE_KEY. The fallback is deliberate and
 * mirrors lib/unsubscribeToken.ts: that variable is already required wherever
 * this code runs and never reaches the browser, so the feature works the day
 * it deploys instead of sitting inert behind an unpasted Vercel variable.
 *
 * New keys are always encrypted under the FIRST configured secret; decryption
 * tries every configured secret in turn. So setting LIVE_DESTINATION_SECRET on
 * a project that has been running on the service-role fallback keeps the keys
 * saved before the switch readable (and rotating the service-role key no
 * longer touches them once the dedicated secret exists). Only a key encrypted
 * under a secret that is gone from the environment altogether becomes
 * undecryptable; the console then shows that destination as needing its key
 * re-entered, which is a two-minute fix per platform.
 *
 * Wire format: `v1.<iv>.<tag>.<ciphertext>` (base64url). Server-only —
 * node:crypto, never imported from a 'use client' module.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const VERSION = 'v1';

/** Every configured secret, preferred first. Empty when none is set. */
function candidateSecrets(): string[] {
    const seen = new Set<string>();
    return [process.env.LIVE_DESTINATION_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
        (s): s is string => {
            if (!s || seen.has(s)) return false;
            seen.add(s);
            return true;
        },
    );
}

function deriveKey(secret: string): Buffer {
    // Domain-separated so the same service-role secret never yields the same
    // key material as any other derivation in the codebase.
    return createHash('sha256').update(`cardstreet:stream-key:${secret}`).digest();
}

/** The key new ciphertexts are written under; null when no secret is configured. */
function derivedKey(): Buffer | null {
    const [primary] = candidateSecrets();
    return primary ? deriveKey(primary) : null;
}

/** Null when no secret is configured — callers refuse to save rather than store plaintext. */
export function encryptStreamKey(plain: string): string | null {
    const key = derivedKey();
    if (!key) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/**
 * Null on a missing secret, a foreign format, or when no configured secret
 * authenticates the ciphertext (GCM rejects a wrong key outright, so trying
 * each candidate in turn can never return garbage from the wrong one).
 */
export function decryptStreamKey(enc: string): string | null {
    if (typeof enc !== 'string') return null;
    const parts = enc.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ct = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    for (const secret of candidateSecrets()) {
        try {
            const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
        } catch {
            // wrong secret for this ciphertext; try the next one
        }
    }
    return null;
}

/** "••••1f2a" — enough for the seller to recognize which key is saved. */
export function streamKeyHint(plain: string): string {
    const tail = plain.slice(-4);
    return `${'•'.repeat(Math.min(4, Math.max(0, plain.length - tail.length)))}${tail}`;
}

/**
 * Stable fingerprint of a FULL stream URL (server URL + key). Stored on
 * stream_simulcast_targets so LiveKit's per-output results can be matched
 * back to a destination without decrypting anything.
 */
export function hashStreamUrl(fullUrl: string): string {
    return createHash('sha256').update(fullUrl).digest('hex');
}
