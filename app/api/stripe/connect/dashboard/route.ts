/**
 * POST /api/stripe/connect/dashboard
 *
 * Generates a Stripe Express Dashboard login link for the logged-in seller
 * so they can review payouts, update bank info, etc. Login links are
 * single-use and expire quickly — must be regenerated on each click.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';

export async function POST() {
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
            .select('stripe_account_id')
            .eq('id', user.id)
            .single();

        if (!profile?.stripe_account_id) {
            return NextResponse.json(
                { error: 'No Stripe account connected' },
                { status: 400 }
            );
        }

        const stripe = getStripe();
        const link = await stripe.accounts.createLoginLink(profile.stripe_account_id);
        return NextResponse.json({ url: link.url });
    } catch (err: any) {
        console.error('[Connect/Dashboard] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to create dashboard link' },
            { status: 500 }
        );
    }
}
