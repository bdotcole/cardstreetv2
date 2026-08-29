/**
 * Admin moderation actions: remove listings, ban/unban accounts.
 *
 * Server-only (uses the service-role client and Stripe secret keys) — never
 * import from a 'use client' module.
 *
 * A ban is enforced at three layers:
 *   1. GoTrue ban (auth.users.banned_until, set via ban_duration) — the hard
 *      lock. Blocks sign-in and token refresh immediately; an already-issued
 *      access token survives at most 1h.
 *   2. profiles.banned_at / banned_reason — the app-visible flag (requires the
 *      20260829_account_bans_listing_removal migration; fails soft without it).
 *   3. Their active/draft listings are taken down in the same call.
 *
 * Optionally the seller's Stripe connected account is rejected
 * (accounts.reject, reason 'fraud'), which permanently disables charges and
 * payouts on it. Stripe cannot un-reject an account — only offer this behind
 * an explicit, clearly-labelled opt-in.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeForRegion, isRegionConfigured, type StripeRegion } from '@/lib/stripe';

// GoTrue has no literal "permanent" — 10 years is the conventional stand-in.
// Reversible any time via ban_duration: 'none'.
const PERMANENT_BAN_DURATION = '87600h';

export interface RemoveListingResult {
    ok: boolean;
    error?: string;
    /** 'removed' normally; 'cancelled' when the migration adding the status hasn't run yet. */
    newStatus?: 'removed' | 'cancelled';
}

export interface BanResult {
    ok: boolean;
    error?: string;
    authBanned: boolean;
    /** false ⇒ profiles.banned_at columns missing (migration not applied) — GoTrue ban still holds. */
    profileFlagged: boolean;
    listingsRemoved: number;
    /** null = not requested; string = attempted but failed with this message. */
    stripeRejected: boolean | string | null;
}

const isMissingColumn = (err: { code?: string; message?: string } | null) =>
    !!err && (err.code === 'PGRST204' || err.code === '42703' || /column .* does not exist/i.test(err.message ?? ''));

const isCheckViolation = (err: { code?: string; message?: string } | null) =>
    !!err && (err.code === '23514' || /check constraint/i.test(err.message ?? ''));

/**
 * Take currently-visible listings (active/draft) off the marketplace. Prefers
 * status='removed' (auditable, distinct from seller cancels) and falls back to
 * 'cancelled' if the CHECK constraint predates the moderation migration.
 * Never touches 'sold' rows — they are order history.
 */
async function takeDownListings(
    filter: { listingId?: string; sellerId?: string },
): Promise<{ count: number; newStatus: 'removed' | 'cancelled'; error?: string }> {
    const supabase = createAdminClient();

    for (const status of ['removed', 'cancelled'] as const) {
        let query = supabase
            .from('listings')
            .update({ status, updated_at: new Date().toISOString() })
            .in('status', ['active', 'draft']);
        if (filter.listingId) query = query.eq('id', filter.listingId);
        if (filter.sellerId) query = query.eq('seller_id', filter.sellerId);

        const { data, error } = await query.select('id');
        if (!error) return { count: data?.length ?? 0, newStatus: status };
        if (!isCheckViolation(error)) return { count: 0, newStatus: status, error: error.message };
    }
    // Unreachable ('cancelled' is always a legal status), but keeps TS honest.
    return { count: 0, newStatus: 'cancelled', error: 'takedown failed' };
}

export async function removeListingAsAdmin(listingId: string): Promise<RemoveListingResult> {
    const supabase = createAdminClient();

    const { data: listing, error } = await supabase
        .from('listings')
        .select('id, status')
        .eq('id', listingId)
        .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!listing) return { ok: false, error: 'Listing not found' };
    if (listing.status === 'sold') return { ok: false, error: 'Listing is sold — it is order history now and cannot be removed' };
    if (listing.status === 'removed') return { ok: true, newStatus: 'removed' };
    if (listing.status === 'cancelled') return { ok: true, newStatus: 'cancelled' };

    const takedown = await takeDownListings({ listingId });
    if (takedown.error) return { ok: false, error: takedown.error };
    return { ok: true, newStatus: takedown.newStatus };
}

export async function banUserAsAdmin(
    userId: string,
    reason: string,
    opts: { rejectStripe?: boolean } = {},
): Promise<BanResult> {
    const supabase = createAdminClient();
    const result: BanResult = {
        ok: false,
        authBanned: false,
        profileFlagged: false,
        listingsRemoved: 0,
        stripeRejected: opts.rejectStripe ? false : null,
    };

    const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, role, display_name, stripe_account_id, stripe_region')
        .eq('id', userId)
        .maybeSingle();
    if (profileErr) return { ...result, error: profileErr.message };
    if (!profile) return { ...result, error: 'Profile not found' };
    if (profile.role === 'admin') return { ...result, error: 'Refusing to ban an admin account' };

    // 1. The hard lock. If this fails, abort — nothing else counts as a ban.
    const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: PERMANENT_BAN_DURATION,
    });
    if (authErr) return { ...result, error: `Auth ban failed: ${authErr.message}` };
    result.authBanned = true;

    // 2. App-visible flag (fails soft until the migration runs).
    const { error: flagErr } = await supabase
        .from('profiles')
        .update({ banned_at: new Date().toISOString(), banned_reason: reason || 'Banned by admin' })
        .eq('id', userId);
    if (!flagErr) result.profileFlagged = true;
    else if (!isMissingColumn(flagErr)) return { ...result, error: `Profile flag failed: ${flagErr.message}` };

    // 3. Take down their marketplace presence.
    const takedown = await takeDownListings({ sellerId: userId });
    if (takedown.error) return { ...result, error: `Listing takedown failed: ${takedown.error}` };
    result.listingsRemoved = takedown.count;

    // 4. Optional, irreversible: kill their payment rails.
    if (opts.rejectStripe) {
        if (!profile.stripe_account_id) {
            result.stripeRejected = 'No Stripe account on file';
        } else {
            const region = (profile.stripe_region as StripeRegion) || 'th';
            if (!isRegionConfigured(region)) {
                result.stripeRejected = `Stripe region '${region}' is not configured`;
            } else {
                try {
                    await getStripeForRegion(region).accounts.reject(profile.stripe_account_id, { reason: 'fraud' });
                    result.stripeRejected = true;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    // An already-rejected account is the state we wanted.
                    result.stripeRejected = /rejected/i.test(message) ? true : message;
                }
            }
        }
    }

    result.ok = true;
    return result;
}

export async function unbanUserAsAdmin(userId: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createAdminClient();

    const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: 'none',
    });
    if (authErr) return { ok: false, error: `Auth unban failed: ${authErr.message}` };

    const { error: flagErr } = await supabase
        .from('profiles')
        .update({ banned_at: null, banned_reason: null })
        .eq('id', userId);
    if (flagErr && !isMissingColumn(flagErr)) return { ok: false, error: flagErr.message };

    // Deliberately does NOT restore listings (re-review them case by case) and
    // cannot un-reject a Stripe account (Stripe doesn't allow it).
    return { ok: true };
}
