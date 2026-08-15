/**
 * POST /api/orders/[id]/label/url
 *
 * Returns a short-lived signed URL that the seller can hand off to a context
 * where cookies don't travel — specifically Android Capacitor WebView's
 * DownloadManager, which makes a fresh request without the WebView's cookies.
 *
 * The signed URL points at /api/orders/[id]/label with sig + exp query params
 * that route validates via lib/labelToken.
 *
 * Cookie-auth + seller ownership are checked here, before issuing the token,
 * so the eventual unsigned-cookies request to /label is allowed to skip those
 * checks (token presence is proof the issuer already verified them).
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { signLabelToken } from '@/lib/labelToken';

const TOKEN_TTL_SECONDS = 300; // 5 minutes

export async function POST(
    _req: Request,
    context: { params: Promise<{ id: string }> }
) {
    const { id: orderId } = await context.params;

    if (!orderId) {
        return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

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

        const { data: order, error: orderErr } = await admin
            .from('orders')
            .select('seller_id, break_spot_id')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }
        if (order.seller_id !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        // Live-break spot orders have no per-order label (parcels consolidate
        // at stream settle) — refuse before issuing a signed URL so clients
        // get a clean 409 instead of a JSON error inside a download tab.
        if (order.break_spot_id) {
            return NextResponse.json(
                {
                    error: 'This is a live-break order — it ships as part of the break parcel after the show.',
                    code: 'LIVE_BREAK_ORDER',
                },
                { status: 409 }
            );
        }

        const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
        let sig: string;
        try {
            sig = signLabelToken(orderId, exp);
        } catch (signErr: any) {
            console.error('[Label/URL] Failed to sign token:', signErr);
            return NextResponse.json(
                { error: signErr.message || 'Server cannot issue signed URLs' },
                { status: 500 }
            );
        }

        // Use the actual request host so this works on custom domains,
        // preview deploys, and localhost without env-var configuration.
        const headersList = await headers();
        const host = headersList.get('host');
        const proto = headersList.get('x-forwarded-proto') || 'https';
        const base = host ? `${proto}://${host}` : 'https://cardstreet.app';

        const url = `${base}/api/orders/${encodeURIComponent(orderId)}/label?sig=${sig}&exp=${exp}`;

        return NextResponse.json({ url, expiresAt: exp });
    } catch (err: any) {
        console.error('[Label/URL] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to issue signed URL' },
            { status: 500 }
        );
    }
}
