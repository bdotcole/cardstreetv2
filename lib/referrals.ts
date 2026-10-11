/**
 * Partner referral helpers — server-side only (imported by route handlers).
 *
 * The referral flow:
 *   1. Partner shares cardstreet.app/join/<partner_qr_slug> (link or QR).
 *   2. app/join/[slug]/route.ts logs a 'click' event, drops the cs_ref
 *      cookie, and routes the visitor to the right store / the web app.
 *   3. After signup, the client calls POST /api/referrals/attribute; the
 *      server reads the cookie (or a ?ref=-sourced slug from the body),
 *      stamps profiles.referred_by, logs a 'signup' event, and bumps the
 *      partner's total_downloads.
 *
 * total_downloads — the tier metric — counts attributed signups, iOS
 * store_visit proxies, and confirmed Android installs (Play Install
 * Referrer via /api/referrals/install) — never raw clicks, and never
 * the same device twice.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Cookie set by /join/<slug>; read server-side at attribution time. */
export const REF_COOKIE = 'cs_ref';

/** How long a /join click stays attributable. */
export const REF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Signups older than this can't be attributed. Keeps the attribute endpoint
 * idempotent-and-safe to call on every sign-in: an existing user who clicks
 * a partner link is never re-attributed.
 */
export const ATTRIBUTION_WINDOW_DAYS = 7;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export function isValidSlugFormat(slug: unknown): slug is string {
    return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

/**
 * Install ids are client-minted UUIDs (lib/installReferrer.ts) that dedupe
 * Android install reports and let signup attribution recognize an
 * already-counted device.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidInstallId(installId: unknown): installId is string {
    return typeof installId === 'string' && UUID_PATTERN.test(installId);
}

/**
 * Domain for partner login emails. These addresses are synthetic internal
 * identifiers — never deliverable, never shown to users — so the partner can
 * sign in with a username before they've supplied a real email. Replaced by
 * the partner's real email when they finish onboarding.
 */
export const PARTNER_LOGIN_EMAIL_DOMAIN = 'partner.cardstreet.app';

export const partnerLoginEmail = (username: string) =>
    `${username.toLowerCase()}@${PARTNER_LOGIN_EMAIL_DOMAIN}`;

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function isValidUsername(username: unknown): username is string {
    return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

/**
 * Lower-case, strip to [a-z0-9_], collapse spaces/dashes to underscores. Mirrors
 * the app's existing username constraint (20260317_add_usernames.sql). Returns
 * '' if nothing usable remains (e.g. a Thai-only shop name) so the caller can
 * require an explicit username instead.
 */
export function sanitizeUsername(raw: string | null | undefined): string {
    return (raw || '')
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20);
}

/**
 * Name-derived slug + 4 random hex chars, mirroring the SQL backfill in
 * 20260611_referral_tracking.sql. ASCII-only on purpose: the slug ends up in
 * printed QR codes and Play Store referrer params, where non-ASCII invites
 * encoding bugs. Thai-only names fall back to 'partner'.
 */
export function generatePartnerSlug(displayName: string | null | undefined): string {
    const base = (displayName || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 20)
        .replace(/^-+|-+$/g, '') || 'partner';
    const suffix = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
    return `${base}-${suffix}`;
}

/**
 * Returns the account's slug, generating and persisting one if missing.
 * Retries on the (unlikely) unique-constraint collision.
 *
 * Returns what is actually STORED, not what was generated. The `.is(null)`
 * guard makes a concurrent second call match zero rows and report no error, so
 * returning the locally generated slug would hand a caller a link that resolves
 * to nothing. That race went from near-impossible to routine when referral
 * slugs stopped being partner-only (2026-09-05): every account now mints on
 * first use, and the mobile shell and desktop can both ask at once.
 */
export async function ensurePartnerSlug(
    admin: SupabaseClient,
    partnerId: string,
    existingSlug: string | null,
    displayName: string | null,
): Promise<string> {
    if (existingSlug) return existingSlug;

    for (let attempt = 0; attempt < 3; attempt++) {
        const slug = generatePartnerSlug(displayName);
        const { data, error } = await admin
            .from('profiles')
            .update({ partner_qr_slug: slug })
            .eq('id', partnerId)
            .is('partner_qr_slug', null)
            .select('partner_qr_slug');
        if (!error) {
            if (data && data.length > 0) return data[0].partner_qr_slug as string;
            // Zero rows updated: someone else won the race and the row already
            // has a slug. Read theirs rather than claiming ours.
            const { data: row } = await admin
                .from('profiles')
                .select('partner_qr_slug')
                .eq('id', partnerId)
                .single();
            const stored = row?.partner_qr_slug as string | null | undefined;
            if (stored) return stored;
            // No slug and no row updated — the profile is gone. Retrying cannot
            // help, and returning a slug nothing resolves to would be worse.
            throw new Error('Profile not found while minting a referral slug');
        }
        // 23505 = unique violation — regenerate and retry; anything else is fatal.
        if (String(error.code) !== '23505') throw new Error(error.message);
    }
    throw new Error('Could not generate a unique referral slug');
}
