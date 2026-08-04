/**
 * POST /api/streams/payment-method/setup
 *
 * Begins "add a card to bid": ensures the caller has a CardStreet platform (TH)
 * Stripe customer and returns a SetupIntent client_secret the client confirms
 * with stripe.confirmSetup(). The saved card is charged off-session at
 * hammer-fall / Buy-It-Now (see lib/liveStreamPayments.ts).
 *
 * Card-only — PromptPay can't be charged off-session, so live bidding requires
 * a card. Gated by the live_streams beta flag AND the Thailand purchase gate
 * (only TH buyers can complete a purchase, so only they can usefully save a
 * live-bidding card).
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBeta } from '@/lib/betaAuth';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import {
    isLiveCustomerValid,
    createLivePlatformCustomer,
    deleteLivePlatformCustomer,
    createLiveCardSetupIntent,
} from '@/lib/liveStreamPayments';

export async function POST(req: Request) {
    const gate = await requireBeta('live_streams');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    // Only TH buyers can purchase, so only they can usefully save a live card.
    if (!isPurchaseAllowedFromCountry(getRequestCountry(req))) {
        return NextResponse.json(
            {
                error: 'Live bidding is currently only available in Thailand.',
                code: 'GEO_RESTRICTED',
            },
            { status: 403 },
        );
    }

    try {
        const admin = createAdminClient();

        const { data: profile, error: profileErr } = await admin
            .from('profiles')
            .select('stripe_customer_id_th')
            .eq('id', user.id)
            .single<{ stripe_customer_id_th: string | null }>();

        if (profileErr || !profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        const existing = profile.stripe_customer_id_th;
        let customerId: string | null = null;

        // 1. Reuse an existing customer only if it still resolves (self-heal a
        //    stale id from a deleted customer / rotated keys).
        if (existing && (await isLiveCustomerValid(existing))) {
            customerId = existing;
        }

        // 2. Otherwise mint one and CLAIM it with a compare-and-swap so
        //    concurrent "add a card" calls converge on a single customer
        //    (no duplicate customer, no orphaned card). The SetupIntent is
        //    created AFTER the winner is resolved, never on a loser.
        if (!customerId) {
            const minted = await createLivePlatformCustomer(user.email ?? null, user.id);

            // CAS: write `minted` only if the row still holds the value we read.
            let claim = admin
                .from('profiles')
                .update({ stripe_customer_id_th: minted })
                .eq('id', user.id);
            claim = existing
                ? claim.eq('stripe_customer_id_th', existing)
                : claim.is('stripe_customer_id_th', null);
            const { data: claimed, error: claimErr } = await claim.select('id');

            if (claimErr) {
                console.error('[Live/PM/setup] CAS persist failed:', claimErr);
                await deleteLivePlatformCustomer(minted);
                return NextResponse.json({ error: 'Failed to save customer' }, { status: 500 });
            }

            if ((claimed?.length ?? 0) === 1) {
                customerId = minted; // We won the race.
            } else {
                // Lost the race — another request persisted first. Drop our
                // orphan and adopt the winner that's now on the row.
                await deleteLivePlatformCustomer(minted);
                const { data: fresh } = await admin
                    .from('profiles')
                    .select('stripe_customer_id_th')
                    .eq('id', user.id)
                    .single<{ stripe_customer_id_th: string | null }>();
                customerId = fresh?.stripe_customer_id_th ?? null;
                if (!customerId) {
                    return NextResponse.json({ error: 'Failed to save customer' }, { status: 500 });
                }
            }
        }

        // 3. SetupIntent on the resolved winner.
        const setupIntent = await createLiveCardSetupIntent(customerId);

        return NextResponse.json({
            clientSecret: setupIntent.client_secret,
            customerId,
        });
    } catch (err) {
        // Never leak Stripe/internal error text to the client on a money path.
        console.error('[Live/PM/setup] Error:', err);
        return NextResponse.json({ error: 'Failed to start card setup' }, { status: 500 });
    }
}
