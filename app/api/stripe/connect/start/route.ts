/**
 * POST /api/stripe/connect/start
 *
 * Begins or resumes Stripe Connect (Express) onboarding for the logged-in seller.
 *
 *   1. If profile has no stripe_account_id, creates an Express account in TH
 *      with transfers capability requested, then saves the id.
 *   2. Generates an AccountLink for onboarding.
 *   3. Returns the URL — client should redirect the seller to it.
 *
 * Idempotent: calling repeatedly returns a fresh AccountLink against the same
 * underlying Stripe account.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getStripe, getAppBaseUrl } from '@/lib/stripe';

export async function POST() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
            .select('id, stripe_account_id, display_name')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        const stripe = getStripe();
        let accountId = profile.stripe_account_id as string | null;

        // Step 1: Create the Express account if we don't already have one.
        if (!accountId) {
            const account = await stripe.accounts.create({
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
                },
            });

            accountId = account.id;

            const { error: saveErr } = await admin
                .from('profiles')
                .update({
                    stripe_account_id: accountId,
                    stripe_account_status: 'pending',
                    stripe_account_updated_at: new Date().toISOString(),
                })
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
        const baseUrl = getAppBaseUrl();
        const accountLink = await stripe.accountLinks.create({
            account: accountId!,
            refresh_url: `${baseUrl}/profile?stripe_connect=refresh`,
            return_url: `${baseUrl}/profile?stripe_connect=complete`,
            type: 'account_onboarding',
        });

        return NextResponse.json({ url: accountLink.url, accountId });
    } catch (err: any) {
        console.error('[Connect/Start] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to start Stripe onboarding' },
            { status: 500 }
        );
    }
}
