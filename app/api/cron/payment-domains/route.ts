/**
 * GET /api/cron/payment-domains — daily sweep (vercel.json).
 *
 * Registers cardstreet.app as a payment method domain on every Thai seller's
 * connected account, so Apple Pay / Google Pay can appear in their checkout
 * (see lib/stripePaymentDomains.ts for why each account needs it). The
 * estimate route and Connect onboarding register accounts as they are used;
 * this catches everyone else, including the sellers who onboarded before
 * either existed. Idempotent: an account that already has the domain costs
 * one list call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripeForRegion, isRegionConfigured } from '@/lib/stripe';
import { ensurePaymentMethodDomains } from '@/lib/stripePaymentDomains';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE = 500;
const CONCURRENCY = 5;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRegionConfigured('th')) {
        return NextResponse.json({ skipped: 'STRIPE_SECRET_KEY_TH not set' });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Paged by id: PostgREST caps a response at 1000 rows whatever .limit() says.
    const accountIds: string[] = [];
    let lastId: string | null = null;
    for (;;) {
        let q = admin
            .from('profiles')
            .select('id, stripe_account_id')
            .eq('stripe_region', 'th')
            .not('stripe_account_id', 'is', null)
            .order('id')
            .limit(PAGE);
        if (lastId) q = q.gt('id', lastId);
        const { data, error } = await q;
        if (error) {
            console.error('[Cron/PaymentDomains] profile query failed:', error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (!data || data.length === 0) break;
        for (const row of data) if (row.stripe_account_id) accountIds.push(row.stripe_account_id);
        lastId = data[data.length - 1].id;
        if (data.length < PAGE) break;
    }

    const stripe = getStripeForRegion('th');
    const tally = { accounts: accountIds.length, ok: 0, created: 0, enabled: 0, errors: 0 };
    const errorSamples: string[] = [];

    let cursor = 0;
    async function worker() {
        while (cursor < accountIds.length) {
            const accountId = accountIds[cursor++];
            const results = await ensurePaymentMethodDomains(stripe, accountId);
            for (const r of results) {
                tally[r.action === 'error' ? 'errors' : r.action]++;
                if (r.action === 'error' && errorSamples.length < 10) {
                    errorSamples.push(`${accountId}: ${r.error}`);
                }
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    console.log('[Cron/PaymentDomains]', JSON.stringify(tally));
    return NextResponse.json({ ...tally, errorSamples });
}
