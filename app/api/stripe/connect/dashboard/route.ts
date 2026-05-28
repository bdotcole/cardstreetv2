/**
 * POST /api/stripe/connect/dashboard
 *
 * Opens the logged-in seller's Stripe account management.
 *
 * Two account shapes coexist:
 *   - Legacy Express accounts (US back-compat) have an Express Dashboard, so
 *     we hand back a single-use, fast-expiring `createLoginLink` URL.
 *   - Current TH accounts are full-dashboard v2 controller accounts. They have
 *     NO Express Dashboard, so createLoginLink fails with "...does not have
 *     access to the Express Dashboard." For these we fall back to a hosted
 *     AccountLink (`account_update` once onboarding is done, `account_onboarding`
 *     otherwise) so the seller can still review/update bank + identity info.
 *
 * Dual-platform: uses the seller's persisted `stripe_region` to pick which
 * Stripe client issues the link.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getStripeForRegion, getAppBaseUrl, type StripeRegion } from '@/lib/stripe';

/**
 * Origins Stripe may redirect the seller back to after an AccountLink flow.
 * Mirrors the allowlist in the connect/start route: cardstreet.app (the host
 * the native app deep-links back from) plus the canonical app base URL, with
 * http://localhost permitted for dev. Guards against open-redirects.
 */
function isPermittedReturnOrigin(url: string): boolean {
    try {
        const u = new URL(url);
        const allowed = new Set<string>(['cardstreet.app']);
        try {
            allowed.add(new URL(getAppBaseUrl()).host);
        } catch {
            // getAppBaseUrl always returns a parseable URL; defensive only.
        }
        if (u.hostname === 'localhost' && u.protocol === 'http:') return true;
        if (u.protocol !== 'https:') return false;
        return allowed.has(u.host);
    } catch {
        return false;
    }
}

// True when createLoginLink was rejected because the account has no Express
// Dashboard (i.e. it's a full-dashboard controller account).
function isNoExpressDashboardError(err: unknown): boolean {
    const e = err as { message?: string };
    return (e?.message || '').toLowerCase().includes('express dashboard');
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: profile } = await admin
            .from('profiles')
            .select('stripe_account_id, stripe_region')
            .eq('id', user.id)
            .single();

        if (!profile?.stripe_account_id) {
            return NextResponse.json(
                { error: 'No Stripe account connected' },
                { status: 400 }
            );
        }

        // Optional return/refresh URLs for the AccountLink fallback. The web UI
        // passes its origin; the native app passes the /mobile-redirect bounce.
        // Both are allowlist-validated; anything else falls back to the
        // canonical app base URL.
        let bodyReturnUrl: string | null = null;
        let bodyRefreshUrl: string | null = null;
        try {
            const body = await request.json().catch(() => null);
            if (typeof body?.returnUrl === 'string' && isPermittedReturnOrigin(body.returnUrl)) {
                bodyReturnUrl = body.returnUrl;
            }
            if (typeof body?.refreshUrl === 'string' && isPermittedReturnOrigin(body.refreshUrl)) {
                bodyRefreshUrl = body.refreshUrl;
            }
        } catch {
            // No body / malformed body — fall back to defaults below.
        }

        const region = (profile.stripe_region === 'us' || profile.stripe_region === 'th')
            ? (profile.stripe_region as StripeRegion)
            : 'us'; // Defensive default — historical accounts predate the column.

        const stripe = getStripeForRegion(region);
        const accountId = profile.stripe_account_id as string;

        try {
            const link = await stripe.accounts.createLoginLink(accountId);
            return NextResponse.json({ url: link.url });
        } catch (loginErr) {
            if (!isNoExpressDashboardError(loginErr)) throw loginErr;

            // Full-dashboard controller account: no Express login link. Send the
            // seller into the hosted onboarding/update flow instead. account_update
            // is only valid once onboarding has been submitted; before that we
            // must use account_onboarding to surface currently-due requirements.
            const baseUrl = getAppBaseUrl();
            const returnUrl = bodyReturnUrl ?? `${baseUrl}/?stripe_connect=complete`;
            const refreshUrl = bodyRefreshUrl ?? `${baseUrl}/?stripe_connect=refresh`;

            const account = await stripe.accounts.retrieve(accountId);
            const linkType: 'account_update' | 'account_onboarding' =
                account.details_submitted ? 'account_update' : 'account_onboarding';

            const accountLink = await stripe.accountLinks.create({
                account: accountId,
                return_url: returnUrl,
                refresh_url: refreshUrl,
                type: linkType,
            });
            return NextResponse.json({ url: accountLink.url });
        }
    } catch (err: any) {
        console.error('[Connect/Dashboard] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to create dashboard link' },
            { status: 500 }
        );
    }
}
