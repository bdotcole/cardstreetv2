import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/shipping/calculate
 *
 * Since 2026-09-27 shipping is inside every listing price (the seller prices
 * it in; checkout charges no shipping line), so there is nothing to quote and
 * no address to gate on. The route stays because the cart still calls it on
 * every open-with-items: the `shipcalc:<uid>` rate-limit row it leaves behind
 * is the only server-side record of a signed-in add-to-cart, and the checkout
 * funnel is read from it. The response shape is unchanged for older clients.
 */
export async function POST(request: NextRequest) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = await checkRateLimit(`shipcalc:${user.id}:1m`, { windowSeconds: 60, max: 30 });
    if (!rl.allowed) {
        return NextResponse.json(
            { error: 'Too many requests. Please wait a moment and try again.' },
            { status: 429, headers: { 'Retry-After': '30' } },
        );
    }

    // Drain the body so the request completes cleanly; its contents no longer
    // influence the answer.
    await request.json().catch(() => null);

    return NextResponse.json({
        success: true,
        totalShippingFee: 0,
        currency: 'THB',
        breakdown: {},
        shippingIncluded: true,
    });
}
