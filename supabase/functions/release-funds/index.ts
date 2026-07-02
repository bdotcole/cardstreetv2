import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

// Dual-platform Stripe clients, keyed by the order's stripe_region.
//   - 'us' → STRIPE_SECRET_KEY (existing US platform)
//   - 'th' → STRIPE_SECRET_KEY_TH (Stripe Thailand platform)
//
// A given order is processed on exactly one platform — whichever charged the
// buyer — so the transfer at payout time MUST happen on that same platform.
// The seller's connected account only exists on the originating platform.
type Region = 'us' | 'th'

const stripeClients: Partial<Record<Region, Stripe>> = {}

function envKeyFor(region: Region): string {
    return region === 'th' ? 'STRIPE_SECRET_KEY_TH' : 'STRIPE_SECRET_KEY'
}

function currencyFor(region: Region): string {
    return region === 'th' ? 'thb' : 'usd'
}

function getStripeForRegion(region: Region): Stripe {
    const cached = stripeClients[region]
    if (cached) return cached

    const envKey = envKeyFor(region)
    const stripeKey = Deno.env.get(envKey)
    if (!stripeKey) {
        throw new Error(`${envKey} environment variable is not set`)
    }

    const client = new Stripe(stripeKey, {
        apiVersion: '2023-10-16',
        httpClient: Stripe.createFetchHttpClient(),
    })
    stripeClients[region] = client
    return client
}

serve(async (_req) => {
    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        console.log('[release-funds] Running funds release job...')

        // Find orders ready for fund release
        // Criteria: delivered OR completed (buyer confirm in /api/orders/complete
        // sets status='completed' immediately for UI truth, with escrow still
        // held), escrow held, past the release date, NOT already paid out
        const { data: orders, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .in('status', ['delivered', 'completed'])
            .eq('escrow_status', 'held')
            .is('stripe_payout_id', null) // Idempotency: skip orders already paid
            .lte('funds_release_at', new Date().toISOString())

        if (fetchError) {
            console.error('[release-funds] Error fetching orders:', fetchError)
            throw new Error('Failed to fetch orders for fund release')
        }

        if (!orders || orders.length === 0) {
            console.log('[release-funds] No orders ready for fund release')
            return new Response(
                JSON.stringify({
                    success: true,
                    processed: 0,
                    message: 'No orders ready for fund release',
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        }

        console.log(`[release-funds] Found ${orders.length} orders ready for fund release`)

        let processed = 0
        let failed = 0
        const results: Array<{ orderId: string; status: string; error?: string }> = []

        for (const order of orders) {
            try {
                console.log(`[release-funds] Processing order ${order.id}...`)

                const orderRegion: Region = order.stripe_region === 'th' ? 'th' : 'us'

                // Acquire the platform's Stripe client. If the key isn't
                // configured for this region we skip the order (rather than
                // failing the whole batch) so the cron keeps making progress
                // on the other region. Once the env var lands, retries pick
                // these up automatically.
                let stripe: Stripe
                try {
                    stripe = getStripeForRegion(orderRegion)
                } catch (envErr: any) {
                    console.warn(
                        `[release-funds] Stripe ${orderRegion.toUpperCase()} not configured — ` +
                        `skipping order ${order.id} until the key is set. ${envErr.message}`
                    )
                    results.push({
                        orderId: order.id,
                        status: 'skipped',
                        error: `Stripe ${orderRegion.toUpperCase()} not configured`,
                    })
                    continue
                }

                // ─── Step 1: Fetch seller's Stripe Connect account ───
                const { data: sellerProfile, error: profileError } = await supabase
                    .from('profiles')
                    .select('stripe_account_id, stripe_region, display_name')
                    .eq('id', order.seller_id)
                    .single()

                if (profileError || !sellerProfile) {
                    console.error(`[release-funds] Could not fetch seller profile for ${order.seller_id}:`, profileError)
                    results.push({ orderId: order.id, status: 'skipped', error: 'Seller profile not found' })
                    failed++
                    continue
                }

                if (!sellerProfile.stripe_account_id) {
                    console.warn(`[release-funds] Seller ${order.seller_id} (${sellerProfile.display_name}) has no Stripe Connect account. Skipping automatic payout.`)
                    results.push({ orderId: order.id, status: 'skipped', error: 'No Stripe Connect account' })
                    // Don't count as failed — just needs manual attention
                    continue
                }

                // Cross-platform mismatch: the order was charged on platform X
                // but the seller's connected account lives on platform Y. We
                // can't transfer across platforms — skip and surface it for
                // manual reconciliation rather than silently ledger-leaking.
                if (sellerProfile.stripe_region && sellerProfile.stripe_region !== orderRegion) {
                    console.error(
                        `[release-funds] Region mismatch: order ${order.id} processed on ${orderRegion} ` +
                        `but seller ${order.seller_id} is on ${sellerProfile.stripe_region}. ` +
                        `Manual payout required.`
                    )
                    results.push({
                        orderId: order.id,
                        status: 'skipped',
                        error: `Seller region (${sellerProfile.stripe_region}) doesn't match order region (${orderRegion})`,
                    })
                    failed++
                    continue
                }

                // ─── Step 2: Calculate payout amount ───
                // For both region paths, the seller receives total_amount
                // minus the platform fee. On TH the application_fee was already
                // taken by Stripe at charge time, so the seller's balance is
                // already (total - app_fee); we payout that whole amount. On
                // US (legacy separate charges + transfers) we explicitly
                // transfer (total - platform_fee) from the platform.
                const totalAmountCents = Math.round((order.total_amount || 0) * 100)
                const platformFeeCents = Math.round((order.platform_fee || 0) * 100)
                const transferAmountCents = totalAmountCents - platformFeeCents

                if (transferAmountCents <= 0) {
                    console.warn(`[release-funds] Transfer amount for order ${order.id} is <= 0 (${transferAmountCents}). Skipping.`)
                    results.push({ orderId: order.id, status: 'skipped', error: 'Transfer amount is zero or negative' })
                    failed++
                    continue
                }

                // ─── Step 3: Release funds — region-specific mechanism ───
                // TH (direct charges): funds went directly to the seller's
                //     Stripe account at charge time. There's no platform
                //     escrow to release — Stripe pays the seller out on
                //     their account's automatic payout schedule. This cron
                //     just marks the order completed and notifies the seller.
                //     No stripe.payouts.create call needed; touching the
                //     payout schedule would require the seller to grant the
                //     platform permission since they own the full dashboard.
                //
                // US (legacy, dormant): platform holds the buyer's payment in
                //     its own balance. We Transfer to the seller's connected
                //     account, which then auto-pays out on Stripe's default
                //     schedule. Same idempotency key strategy.
                const transferCurrency = currencyFor(orderRegion)
                let payoutOrTransferId: string

                if (orderRegion === 'th') {
                    // No Stripe call. Funds are already with the seller.
                    // Use the order id as the "synthetic" payout id so the
                    // DB write below remains idempotent and we keep the
                    // stripe_payout_id IS NULL guard meaningful for retries.
                    payoutOrTransferId = `direct_charge_${order.id}`
                    console.log(`[release-funds] Marking order ${order.id} completed (TH direct charge — funds already with seller)`)
                } else {
                    console.log(`[release-funds] Transferring ${transferAmountCents} ${transferCurrency} subunits to ${sellerProfile.stripe_account_id} for order ${order.id} on US platform...`)
                    // Stripe Idempotency-Key keyed on order.id closes two race windows:
                    //   1. Transfer succeeds, but the subsequent DB update fails.
                    //      Next cron tick sees stripe_payout_id IS NULL and retries —
                    //      without an idempotency key, that would create a SECOND
                    //      transfer. With this key, Stripe returns the original.
                    //   2. Two concurrent cron invocations both pass the SELECT and
                    //      both call transfers.create before either does the DB CAS.
                    //      Stripe dedupes on the key and only one transfer is created.
                    // Stripe stores idempotency keys for 24 hours; that's well within
                    // any reasonable retry window for this job.
                    const transfer = await stripe.transfers.create(
                        {
                            amount: transferAmountCents,
                            currency: transferCurrency,
                            destination: sellerProfile.stripe_account_id,
                            transfer_group: order.transfer_group || undefined,
                            metadata: {
                                order_id: order.id,
                                seller_id: order.seller_id,
                                release_type: 'auto_escrow',
                                stripe_region: orderRegion,
                            },
                        },
                        {
                            idempotencyKey: `payout_${order.id}`,
                        }
                    )
                    payoutOrTransferId = transfer.id
                    console.log(`[release-funds] Stripe Transfer ${transfer.id} created for order ${order.id}`)
                }

                // ─── Step 4: Update order record ───
                const { error: updateError } = await supabase
                    .from('orders')
                    .update({
                        escrow_status: 'released',
                        status: 'completed',
                        // Keep the buyer's confirm time if /api/orders/complete
                        // already stamped it; this tick is bookkeeping, not the event.
                        completed_at: order.completed_at || new Date().toISOString(),
                        stripe_payout_id: payoutOrTransferId,
                    })
                    .eq('id', order.id)
                    .eq('escrow_status', 'held') // Double-check: only update if still held (race condition guard)

                if (updateError) {
                    console.error(`[release-funds] Failed to update order ${order.id} after payout:`, updateError)
                    results.push({ orderId: order.id, status: 'transfer_ok_db_failed', error: updateError.message })
                    failed++
                    continue
                }

                console.log(`[release-funds] Successfully released funds for order ${order.id} → ${payoutOrTransferId}`)
                results.push({ orderId: order.id, status: 'success' })
                processed++

                // ─── Compute the figure to show the seller ───
                // transferAmountCents = total - platform_fee. On US that's the
                // exact amount we Transfer. On TH it OVERSTATES the deposit: it's
                // a direct charge, so Stripe already debited its processing fee
                // from the seller's balance at charge time. The seller's real net
                // is the charge's balance_transaction.net (amount - Stripe fee -
                // application_fee). Pull it so the notification matches what
                // actually landed in their account. Fall back to the gross figure
                // only if the lookup fails — a slightly high number beats none.
                let notifyNetCents = transferAmountCents
                if (orderRegion === 'th' && order.payment_id) {
                    try {
                        const pi = await stripe.paymentIntents.retrieve(
                            order.payment_id,
                            { expand: ['latest_charge.balance_transaction'] },
                            { stripeAccount: sellerProfile.stripe_account_id }
                        )
                        const charge = pi.latest_charge
                        const bt = (charge && typeof charge === 'object') ? charge.balance_transaction : null
                        if (bt && typeof bt === 'object' && typeof bt.net === 'number') {
                            notifyNetCents = bt.net
                        }
                    } catch (feeErr: any) {
                        console.warn(`[release-funds] Could not read balance transaction for order ${order.id}; payout notification will show the pre-Stripe-fee figure. ${feeErr.message}`)
                    }
                }

                // ─── Step 5: Send Courier Notification ───
                try {
                    const courierToken = Deno.env.get('COURIER_AUTH_TOKEN')
                    if (courierToken) {
                        const { CourierClient } = await import('https://esm.sh/@trycourier/courier')
                        const courier = new CourierClient({ authorizationToken: courierToken })

                        // Fetch email and preferences
                        const { data: userAuth, error: authErr } = await supabase.auth.admin.getUserById(order.seller_id)
                        const email = (!authErr && userAuth?.user?.email) ? userAuth.user.email : null

                        const { data: prefs } = await supabase
                            .from('notification_preferences')
                            .select('*')
                            .eq('user_id', order.seller_id)
                            .single()

                        const wantEmail = prefs?.payout_email !== false
                        const wantPush = prefs?.payout_push !== false
                        const fcmToken = prefs?.fcm_token || null

                        if ((wantEmail && email) || (wantPush && fcmToken)) {
                            const recipient: any = {}
                            const channels: string[] = []

                            if (wantEmail && email) {
                                recipient.email = email
                                channels.push("email")
                            }
                            if (wantPush && fcmToken) {
                                recipient.firebaseToken = fcmToken
                                channels.push("push")
                            }

                            const currencySymbol = orderRegion === 'th' ? '฿' : '$'
                            await courier.send({
                                message: {
                                    to: recipient,
                                    content: {
                                        title: "CardStreet: Payout Sent! 💸",
                                        body: `Your payout of ${currencySymbol}${(notifyNetCents / 100).toLocaleString()} for order ${order.id} has been successfully transferred to your Stripe account.`,
                                    },
                                    routing: { method: "all", channels },
                                    data: { orderId: order.id, type: 'payout_completed', amount: notifyNetCents / 100, currency: transferCurrency }
                                }
                            })
                            console.log(`[release-funds] Sent payout_completed notification to seller ${order.seller_id}`)
                        }
                    } else {
                        console.warn('[release-funds] COURIER_AUTH_TOKEN not set, skipping notification')
                    }
                } catch (notifErr: any) {
                    console.error(`[release-funds] Failed to send payout notification for order ${order.id}:`, notifErr)
                    // Do not fail the whole job just because the notification failed
                }

            } catch (orderError: any) {
                console.error(`[release-funds] Error processing order ${order.id}:`, orderError)
                results.push({ orderId: order.id, status: 'error', error: orderError.message })
                failed++
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                processed,
                failed,
                total: orders.length,
                results,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            }
        )
    } catch (error: any) {
        console.error('[release-funds] Fatal error:', error)
        return new Response(
            JSON.stringify({
                error: error.message || 'Internal server error',
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        )
    }
})
