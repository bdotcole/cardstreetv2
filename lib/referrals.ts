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
 * total_downloads — the tier metric — counts attributed signups (plus any
 * future native install-referrer events), never raw clicks.
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
 * Returns the partner's slug, generating and persisting one if missing.
 * Retries on the (unlikely) unique-constraint collision.
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
        const { error } = await admin
            .from('profiles')
            .update({ partner_qr_slug: slug })
            .eq('id', partnerId)
            .is('partner_qr_slug', null);
        if (!error) return slug;
        // 23505 = unique violation — regenerate and retry; anything else is fatal.
        if (String(error.code) !== '23505') throw new Error(error.message);
    }
    throw new Error('Could not generate a unique referral slug');
}
