/**
 * GET /api/orders/pay-context?transferGroup=...
 *
 * Payment context for orders that ALREADY exist in pending_payment (auction
 * wins today; any pay-again flow tomorrow). Mirrors what /api/orders/estimate
 * provides for the cart flow -- totals plus the seller's connected account id
 * so PaymentModal can bind Stripe.js to the right account for the TH direct
 * charge -- but reads it off the existing order rows instead of simulating.
 *
 * Auth: caller must be the buyer of every order in the group.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const cookieSupabase = await createServerClient();
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const transferGroup = new URL(req.url).searchParams.get('transferGroup');
    if (!transferGroup) {
        return NextResponse.json({ error: 'transferGroup is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: orders, error } = await admin
        .from('orders')
        .select('id, buyer_id, seller_id, status, total_amount, shipping_fee, stripe_region')
        .eq('transfer_group', transferGroup);

    if (error) {
        console.error('[PayContext] order lookup failed:', error);
        return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
    }
    if (!orders || orders.length === 0) {
        return NextResponse.json({ error: 'No orders for this transferGroup' }, { status: 404 });
    }
    if (!orders.every(o => o.buyer_id === user.id)) {
        return NextResponse.json({ error: 'Not your orders' }, { status: 403 });
    }
    if (!orders.every(o => o.status === 'pending_payment')) {
        return NextResponse.json(
            { error: 'These orders are not payable', code: 'NOT_PAYABLE' },
            { status: 409 },
        );
    }

    const subtotal = orders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const shipping = orders.reduce((s, o) => s + Number(o.shipping_fee || 0), 0);

    // Single seller by construction for TH groups (and for all auction orders).
    const sellerIds = [...new Set(orders.map(o => o.seller_id))];
    let sellerStripeAccountId: string | null = null;
    let sellerPayoutReady = true;
    if (orders[0].stripe_region === 'th' && sellerIds.length === 1) {
        const { data: seller } = await admin
            .from('profiles')
            .select('stripe_account_id, stripe_charges_enabled')
            .eq('id', sellerIds[0])
            .single();
        sellerStripeAccountId = seller?.stripe_account_id ?? null;
        sellerPayoutReady = !!(seller?.stripe_account_id && seller?.stripe_charges_enabled);
    }

    return NextResponse.json({
        success: true,
        transferGroup,
        subtotal,
        shipping,
        total: subtotal + shipping,
        sellerStripeAccountId,
        sellerPayoutReady,
        region: orders[0].stripe_region === 'th' ? 'th' : 'us',
    });
}
