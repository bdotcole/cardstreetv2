/**
 * GET /api/stripe/connect/status
 *
 * Returns the logged-in seller's Stripe Connect status. Optionally refreshes
 * the local DB cache by querying Stripe directly (?refresh=1).
 *
 * The webhook keeps the cache up-to-date most of the time, but on the return
 * from onboarding we want an immediate refresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getStripe, deriveConnectStatus } from '@/lib/stripe';

export async function GET(request: NextRequest) {
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

        type ConnectProfile = {
            stripe_account_id: string | null;
            stripe_account_status: string | null;
            stripe_charges_enabled: boolean | null;
            stripe_payouts_enabled: boolean | null;
            stripe_details_submitted: boolean | null;
        };

        const { data: profile } = await admin
            .from('profiles')
            .select(
                'stripe_account_id, stripe_account_status, stripe_charges_enabled, ' +
                'stripe_payouts_enabled, stripe_details_submitted'
            )
            .eq('id', user.id)
            .single<ConnectProfile>();

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        const shouldRefresh = request.nextUrl.searchParams.get('refresh') === '1';

        // Refresh from Stripe if requested and we have an account on file.
        if (shouldRefresh && profile.stripe_account_id) {
            try {
                const stripe = getStripe();
                const account = await stripe.accounts.retrieve(profile.stripe_account_id);

                const status = deriveConnectStatus(account);

                await admin
                    .from('profiles')
                    .update({
                        stripe_account_status: status,
                        stripe_charges_enabled: account.charges_enabled,
                        stripe_payouts_enabled: account.payouts_enabled,
                        stripe_details_submitted: account.details_submitted,
                        stripe_account_updated_at: new Date().toISOString(),
                    })
                    .eq('id', user.id);

                return NextResponse.json({
                    connected: true,
                    accountId: profile.stripe_account_id,
                    status,
                    chargesEnabled: account.charges_enabled,
                    payoutsEnabled: account.payouts_enabled,
                    detailsSubmitted: account.details_submitted,
                });
            } catch (refreshErr: any) {
                console.error('[Connect/Status] Refresh failed:', refreshErr);
                // Fall through to return cached values
            }
        }

        return NextResponse.json({
            connected: !!profile.stripe_account_id,
            accountId: profile.stripe_account_id,
            status: profile.stripe_account_status,
            chargesEnabled: profile.stripe_charges_enabled,
            payoutsEnabled: profile.stripe_payouts_enabled,
            detailsSubmitted: profile.stripe_details_submitted,
        });
    } catch (err: any) {
        console.error('[Connect/Status] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to fetch Stripe status' },
            { status: 500 }
        );
    }
}

