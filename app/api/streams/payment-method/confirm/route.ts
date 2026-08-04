/**
 * POST /api/streams/payment-method/confirm
 *
 * Finalizes "add a card to bid": after the client confirms the SetupIntent with
 * stripe.confirmSetup(), it POSTs the setupIntentId here. We re-verify the
 * SetupIntent server-side (status succeeded, belongs to this user's platform
 * customer) and persist the saved PaymentMethod id to
 * profiles.live_default_payment_method — the id charged off-session on wins.
 *
 * Body: { setupIntentId: string }
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBeta } from '@/lib/betaAuth';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import { getStripeForRegion } from '@/lib/stripe';

export async function POST(req: Request) {
    const gate = await requireBeta('live_streams');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    // Same TH-only gate as setup, for consistency/defense-in-depth (fails open
    // on unknown country, matching lib/geo.ts).
    if (!isPurchaseAllowedFromCountry(getRequestCountry(req))) {
        return NextResponse.json(
            { error: 'Live bidding is currently only available in Thailand.', code: 'GEO_RESTRICTED' },
            { status: 403 },
        );
    }

    try {
        const body = await req.json().catch(() => ({}));
        const setupIntentId = body?.setupIntentId;
        if (!setupIntentId || typeof setupIntentId !== 'string') {
            return NextResponse.json({ error: 'setupIntentId is required' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { data: profile, error: profileErr } = await admin
            .from('profiles')
            .select('stripe_customer_id_th')
            .eq('id', user.id)
            .single<{ stripe_customer_id_th: string | null }>();

        if (profileErr || !profile?.stripe_customer_id_th) {
            return NextResponse.json(
                { error: 'No live customer on file — run setup first' },
                { status: 409 },
            );
        }

        const stripe = getStripeForRegion('th');
        const si = await stripe.setupIntents.retrieve(setupIntentId);

        if (si.status !== 'succeeded') {
            return NextResponse.json(
                { error: `Card not saved (status: ${si.status})`, status: si.status },
                { status: 409 },
            );
        }

        // The SetupIntent must belong to THIS user's platform customer — never
        // trust a client-supplied id to bind a card to someone else.
        const siCustomer = typeof si.customer === 'string' ? si.customer : si.customer?.id ?? null;
        if (siCustomer !== profile.stripe_customer_id_th) {
            return NextResponse.json({ error: 'SetupIntent does not belong to you' }, { status: 403 });
        }

        const pmId = typeof si.payment_method === 'string'
            ? si.payment_method
            : si.payment_method?.id ?? null;
        if (!pmId) {
            return NextResponse.json({ error: 'SetupIntent has no payment method' }, { status: 409 });
        }

        const { error: saveErr } = await admin
            .from('profiles')
            .update({ live_default_payment_method: pmId })
            .eq('id', user.id);
        if (saveErr) {
            console.error('[Live/PM/confirm] Failed to persist live_default_payment_method:', saveErr);
            return NextResponse.json({ error: 'Failed to save card' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, paymentMethod: pmId });
    } catch (err) {
        // Never leak Stripe/internal error text to the client on a money path.
        console.error('[Live/PM/confirm] Error:', err);
        return NextResponse.json({ error: 'Failed to confirm card' }, { status: 500 });
    }
}
