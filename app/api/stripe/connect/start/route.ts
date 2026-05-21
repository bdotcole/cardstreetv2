/**
 * POST /api/stripe/connect/start
 *
 * Begins or resumes Stripe Connect (Express) onboarding for the logged-in
 * seller. Dual-platform: the seller's `preferred_currency` selects which
 * platform (US or TH) creates the connected account.
 *
 *   - preferred_currency='thb' → TH platform, standard merchant agreement
 *   - preferred_currency='usd' → US platform, recipient agreement
 *
 * If the seller's desired platform isn't configured yet (e.g. TH key not in
 * Vercel), we fall back to the US platform so onboarding still works. The
 * resulting platform is persisted to profiles.stripe_region and is sticky —
 * Stripe doesn't let an Express account move between platforms.
 *
 * Idempotent: calling repeatedly returns a fresh AccountLink against the same
 * underlying Stripe account on the seller's persisted region.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
    getStripeForRegion,
    getAppBaseUrl,
    isRegionConfigured,
    type StripeRegion,
} from '@/lib/stripe';
import type Stripe from 'stripe';

function regionForCurrency(currency: string | null | undefined): StripeRegion {
    return currency === 'thb' ? 'th' : 'us';
}

/**
 * Origins we'll let Stripe redirect the seller back to after onboarding.
 * Stripe accountLinks require absolute https URLs (or http://localhost for
 * dev), so we validate any client-supplied returnUrl against this allowlist
 * to prevent open-redirects.
 *
 * `cardstreet.app` is always permitted because that's the host the Android
 * Capacitor app registers via App Links (autoVerify in AndroidManifest.xml).
 * Sending Stripe there means the post-onboarding click on "Return to
 * CardStreet" deep-links straight into the native app instead of bouncing
 * the seller to a browser tab on the Vercel preview URL.
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

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Optional body overrides for first-time onboarding. The UI passes:
        //   - `currency`: which platform (US/TH) to onboard on
        //   - `returnUrl` / `refreshUrl`: where Stripe should redirect the
        //     seller back to. Validated against the allowlist below; an
        //     out-of-list value is ignored and we fall back to the canonical
        //     getAppBaseUrl() (which the Android app App-Links-intercepts).
        //
        // If the seller already has an account, currency is ignored and we use
        // the persisted region (Stripe accounts can't move between platforms).
        let bodyCurrency: 'usd' | 'thb' | null = null;
        let bodyReturnUrl: string | null = null;
        let bodyRefreshUrl: string | null = null;
        try {
            const body = await request.json().catch(() => null);
            const c = body?.currency;
            if (c === 'usd' || c === 'thb') bodyCurrency = c;
            if (typeof body?.returnUrl === 'string' && isPermittedReturnOrigin(body.returnUrl)) {
                bodyReturnUrl = body.returnUrl;
            }
            if (typeof body?.refreshUrl === 'string' && isPermittedReturnOrigin(body.refreshUrl)) {
                bodyRefreshUrl = body.refreshUrl;
            }
        } catch {
            // No body / malformed body — fall back to defaults below.
        }

        // Use the service-role client for writes so the seller doesn't need RLS
        // permission to update their own stripe_account_id. (RLS UPDATE policy
        // only covers seller-owned listings/orders; profiles has its own policies
        // which may not include these new columns.)
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: profile, error: profileErr } = await admin
            .from('profiles')
            .select('id, stripe_account_id, stripe_region, display_name, preferred_currency')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        // Pick the region:
        //   1. If the seller already has a connected account, use its region —
        //      Stripe Express accounts can't move between platforms.
        //   2. Otherwise prefer the body override (explicit UI choice), then
        //      profile.preferred_currency.
        //   3. If the desired region isn't configured (e.g. TH key missing),
        //      fall back to 'us' so onboarding still works.
        let region: StripeRegion;
        if (profile.stripe_region === 'us' || profile.stripe_region === 'th') {
            region = profile.stripe_region;
        } else {
            const desiredCurrency = bodyCurrency ?? profile.preferred_currency;
            const desired = regionForCurrency(desiredCurrency);
            region = isRegionConfigured(desired) ? desired : 'us';
        }

        const stripe = getStripeForRegion(region);
        let accountId = profile.stripe_account_id as string | null;

        // Step 1: Create the Express account if we don't already have one.
        //
        // Two account shapes depending on platform:
        //   - US platform: country='TH', service_agreement='recipient'. The
        //     seller only receives transfers from CardStreet (the platform is
        //     merchant of record). Lighter KYC. Matches the pre-dual-platform
        //     setup exactly.
        //   - TH platform: country='TH', standard merchant agreement. The
        //     seller is local to the platform's jurisdiction, so the recipient
        //     workaround isn't needed.
        //
        // Docs: https://stripe.com/docs/connect/service-agreement-types
        if (!accountId) {
            const createParams: Stripe.AccountCreateParams = {
                type: 'express',
                country: 'TH',
                email: user.email || undefined,
                capabilities: {
                    transfers: { requested: true },
                },
                business_type: 'individual',
                metadata: {
                    cardstreet_user_id: user.id,
                    cardstreet_display_name: profile.display_name || '',
                    cardstreet_region: region,
                },
            };

            if (region === 'us') {
                createParams.tos_acceptance = { service_agreement: 'recipient' };
            }

            const account = await stripe.accounts.create(createParams);
            accountId = account.id;

            const updates: Record<string, unknown> = {
                stripe_account_id: accountId,
                stripe_region: region,
                stripe_account_status: 'pending',
                stripe_account_updated_at: new Date().toISOString(),
            };
            // If the UI provided an explicit currency choice, persist it so
            // future flows (display, FX, listings) honor the seller's pick.
            if (bodyCurrency) updates.preferred_currency = bodyCurrency;

            const { error: saveErr } = await admin
                .from('profiles')
                .update(updates)
                .eq('id', user.id);

            if (saveErr) {
                console.error('[Connect/Start] Failed to persist stripe_account_id:', saveErr);
                return NextResponse.json(
                    { error: 'Failed to save Stripe account' },
                    { status: 500 }
                );
            }
        }

        // Step 2: Generate the onboarding AccountLink.
        //
        // Use getAppBaseUrl() (cardstreet.app or NEXT_PUBLIC_APP_URL) as the
        // default — NOT the request host. The Android Capacitor app only
        // App-Links-intercepts cardstreet.app, so sending Stripe back to a
        // Vercel preview hostname would dead-end the seller in a browser tab
        // and they'd never make it back to the native app to refresh status.
        //
        // Client can override via body.returnUrl/refreshUrl (already
        // allowlist-validated above) — this lets the web build pass
        // window.location.origin for non-cardstreet.app domains.
        const baseUrl = getAppBaseUrl();
        const returnUrl = bodyReturnUrl ?? `${baseUrl}/?stripe_connect=complete`;
        const refreshUrl = bodyRefreshUrl ?? `${baseUrl}/?stripe_connect=refresh`;

        const accountLink = await stripe.accountLinks.create({
            account: accountId!,
            refresh_url: refreshUrl,
            return_url: returnUrl,
            type: 'account_onboarding',
        });

        return NextResponse.json({ url: accountLink.url, accountId, region });
    } catch (err: any) {
        console.error('[Connect/Start] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to start Stripe onboarding' },
            { status: 500 }
        );
    }
}
