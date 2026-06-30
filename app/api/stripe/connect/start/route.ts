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
            // full_name / phone_number / shipping address are pulled so we can
            // pre-fill Stripe's `individual` person + business support phone.
            // These are the exact fields Stripe surfaces as the "representative"
            // and "support phone number" onboarding hoops; pre-filling them from
            // data the seller already gave us (for Flash Express shipping)
            // collapses those steps instead of making the seller re-type them.
            .select('id, stripe_account_id, stripe_region, display_name, preferred_currency, full_name, phone_number, address, district, state, province, postcode, stripe_details_submitted')
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

        // Pre-fill builder for the individual (person) + support phone, from the
        // profile data we already hold for Flash Express shipping. Reused by the
        // create path AND the resume path, so a seller who abandoned onboarding
        // gets the same shortened form when they come back. Every field here is
        // one fewer hoop in Stripe's hosted onboarding — it pre-populates the
        // "representative", the support phone, and the required Thai "job title".
        //
        // We do NOT lock business_type beyond setting it to 'individual' — Stripe
        // has no API flag that hard-disables the individual/company toggle.
        // Supplying individual data is what keeps the hosted flow on the
        // individual path (company is what pulls director/representative fields).
        function buildIndividualPrefill(): {
            individual: Stripe.AccountCreateParams.Individual;
            supportPhone?: string;
        } {
            const toThE164 = (raw?: string | null): string | undefined => {
                if (!raw) return undefined;
                const d = raw.replace(/[^\d+]/g, '');
                if (!d) return undefined;
                if (d.startsWith('+')) return d;
                if (d.startsWith('0')) return `+66${d.slice(1)}`;
                if (d.startsWith('66')) return `+${d}`;
                return `+66${d}`;
            };
            const phone = toThE164(profile!.phone_number as string | null);

            // full_name is the shipping recipient (their real/legal name), so it
            // is a safe seed for first/last. display_name is often a handle, so we
            // deliberately don't fall back to it — a wrong legal name would
            // mismatch the ID at verification, which is worse than leaving it blank.
            const fullName = ((profile!.full_name as string | null) || '').trim();
            const nameParts = fullName ? fullName.split(/\s+/) : [];
            const firstName = nameParts[0];
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

            // Field-name mapping: profiles.state holds the city, profiles.province
            // holds the Thai province (Stripe's `state`). See profileValidation.ts.
            const street = (profile!.address as string | null) || '';
            const individualAddress: Stripe.AddressParam | undefined = street
                ? {
                      line1: street,
                      line2: (profile!.district as string | null) || undefined,
                      city: (profile!.state as string | null) || undefined,
                      state: (profile!.province as string | null) || undefined,
                      postal_code: (profile!.postcode as string | null) || undefined,
                      country: 'TH',
                  }
                : undefined;

            const individual: Stripe.AccountCreateParams.Individual = {
                email: user!.email || undefined,
                // Thai individual accounts surface individual.relationship.title
                // ("job title") as required — it was on every restricted account
                // in the diagnostic. A sole seller's title is just "Owner".
                relationship: { title: 'Owner' },
                ...(firstName ? { first_name: firstName, last_name: lastName } : {}),
                ...(phone ? { phone } : {}),
                ...(individualAddress ? { address: individualAddress } : {}),
            };

            return { individual, supportPhone: phone };
        }

        // Step 1: Create the connected account if we don't already have one.
        //
        // This platform is configured (Connect → Platform setup) as:
        //   - Business model: direct charges (sellers collect payments directly)
        //   - Losses: Stripe is responsible (defaults.responsibilities.losses_collector = stripe)
        //   - Fees: collected from seller (defaults.responsibilities.fees_collector = account)
        //   - Dashboard: full Stripe Dashboard (defaults.dashboard = full)
        //   - Accounts v2 enabled
        //
        // Given that platform setup, we do NOT pass `type: 'express'` (which
        // would create a v1 Express account incompatible with v2 controller
        // defaults — Stripe rejects with "Platforms in TH cannot create
        // accounts where the platform is loss-liable"). We let Stripe use
        // the platform's default controller config and just request the
        // capabilities the seller needs: card_payments (to accept charges
        // directly) and transfers (so we can take an application_fee_amount).
        //
        // Pre-filling business_profile (url, product_description, mcc) lets
        // Stripe skip those fields in the hosted onboarding so individual
        // sellers without a website aren't blocked on a required URL field.
        //
        // Docs:
        //   https://stripe.com/docs/connect/direct-charges
        //   https://stripe.com/docs/connect/account-controllers
        async function createFreshAccount(): Promise<string> {
            const sellerPublicUrl = `${getAppBaseUrl()}/profile/${user!.id}`;
            const { individual, supportPhone } = buildIndividualPrefill();

            const createParams: Stripe.AccountCreateParams = {
                country: 'TH',
                email: user!.email || undefined,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                    // PromptPay is Thailand's dominant payment method. Requesting
                    // it here lets the buyer-side PaymentElement offer PromptPay
                    // on this seller's direct charges. TH-only capability; on the
                    // legacy US path below it's simply never requested.
                    ...(region === 'th' ? { promptpay_payments: { requested: true } } : {}),
                },
                business_type: 'individual',
                individual,
                business_profile: {
                    // Pre-filled so individual sellers without a website
                    // aren't blocked on a required URL field. The seller's
                    // CardStreet profile page is the closest analog to a
                    // business URL.
                    url: sellerPublicUrl,
                    product_description: 'Trading card sales on CardStreet marketplace',
                    // 5945 = Hobby, Toy, and Game Shops — closest MCC for TCG
                    // sales. Influences Stripe risk scoring and the buyer's
                    // statement descriptor.
                    mcc: '5945',
                    // Satisfies the standalone "provide a support phone number"
                    // onboarding requirement up front when we have the seller's
                    // phone. Omitted (not sent as undefined) when we don't.
                    ...(supportPhone ? { support_phone: supportPhone } : {}),
                },
                metadata: {
                    cardstreet_user_id: user!.id,
                    cardstreet_display_name: profile!.display_name || '',
                    cardstreet_region: region,
                },
            };

            // Legacy US path (kept for the back-compat dual-platform code
            // path even though we don't currently operate the US platform):
            // recipient agreement = platform is MOR. Not used today.
            if (region === 'us') {
                createParams.type = 'express';
                createParams.tos_acceptance = { service_agreement: 'recipient' };
            }

            const account = await stripe.accounts.create(createParams);

            const updates: Record<string, unknown> = {
                stripe_account_id: account.id,
                stripe_region: region,
                stripe_account_status: 'pending',
                // Reset cached capability flags from any stale prior account.
                stripe_charges_enabled: false,
                stripe_payouts_enabled: false,
                stripe_details_submitted: false,
                stripe_account_updated_at: new Date().toISOString(),
            };
            // If the UI provided an explicit currency choice, persist it so
            // future flows (display, FX, listings) honor the seller's pick.
            if (bodyCurrency) updates.preferred_currency = bodyCurrency;

            const { error: saveErr } = await admin
                .from('profiles')
                .update(updates)
                .eq('id', user!.id);

            if (saveErr) {
                console.error('[Connect/Start] Failed to persist stripe_account_id:', saveErr);
                throw new Error('Failed to save Stripe account');
            }

            return account.id;
        }

        if (!accountId) {
            accountId = await createFreshAccount();
        } else if (region === 'th') {
            // Existing TH account. Two best-effort, idempotent updates before we
            // hand back a resume link — neither ever blocks onboarding:
            //   1. Request promptpay_payments (no-op if already active) so the
            //      buyer-side PaymentElement can offer PromptPay.
            //   2. If the seller never finished onboarding (details not yet
            //      submitted), push the same individual pre-fill we apply to
            //      fresh accounts, so a previously-abandoned account gets the
            //      shortened form on resume too. Guarded on details_submitted so
            //      we never overwrite data a seller has already entered/submitted.
            try {
                const update: Stripe.AccountUpdateParams = {
                    capabilities: { promptpay_payments: { requested: true } },
                };
                // Cached flag (kept fresh by the webhook + status?refresh). If
                // it's not positively true, treat onboarding as unfinished and
                // pre-fill — the worst case is a no-op on an account that turns
                // out to be complete.
                if (profile.stripe_details_submitted !== true) {
                    const { individual, supportPhone } = buildIndividualPrefill();
                    update.individual = individual;
                    if (supportPhone) update.business_profile = { support_phone: supportPhone };
                }
                await stripe.accounts.update(accountId, update);
            } catch (capErr) {
                console.warn('[Connect/Start] Could not update existing TH account (promptpay/prefill):', capErr);
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

        // Self-heal a stale stripe_account_id. This happens when the stored
        // account ID was created against a different Stripe platform than the
        // one currently configured — e.g. test/live key swap, key rotation
        // back to a different platform account, or a manual deletion in the
        // Stripe Dashboard. Stripe responds with code='account_invalid' /
        // 'resource_missing' and a message like "account ... is not connected
        // to your platform or does not exist". Rather than dead-ending the
        // seller, we clear the row and onboard them on a fresh account.
        async function isStaleAccountError(err: unknown): Promise<boolean> {
            const e = err as { code?: string; message?: string; type?: string };
            if (e?.code === 'resource_missing' || e?.code === 'account_invalid') return true;
            const msg = (e?.message || '').toLowerCase();
            return (
                msg.includes('not connected to your platform') ||
                msg.includes('does not exist')
            );
        }

        let accountLink: Stripe.AccountLink;
        try {
            accountLink = await stripe.accountLinks.create({
                account: accountId!,
                refresh_url: refreshUrl,
                return_url: returnUrl,
                type: 'account_onboarding',
            });
        } catch (linkErr) {
            if (!(await isStaleAccountError(linkErr))) throw linkErr;

            console.warn(
                `[Connect/Start] Stale stripe_account_id ${accountId} for user ${user.id} on ${region} — ` +
                `clearing and creating a fresh account.`
            );

            accountId = await createFreshAccount();
            accountLink = await stripe.accountLinks.create({
                account: accountId!,
                refresh_url: refreshUrl,
                return_url: returnUrl,
                type: 'account_onboarding',
            });
        }

        return NextResponse.json({ url: accountLink.url, accountId, region });
    } catch (err: any) {
        console.error('[Connect/Start] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to start Stripe onboarding' },
            { status: 500 }
        );
    }
}
