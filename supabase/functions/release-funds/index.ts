import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

serve(async (req) => {
    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
        if (!stripeKey) {
            throw new Error('STRIPE_SECRET_KEY environment variable is not set')
        }

        const stripe = new Stripe(stripeKey, {
            apiVersion: '2023-10-16',
            httpClient: Stripe.createFetchHttpClient(),
        })

        console.log('[release-funds] Running funds release job...')

        // Find orders ready for fund release
        // Criteria: delivered, escrow held, past the 48-hour release date, NOT already paid out
        const { data: orders, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'delivered')
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

                // ─── Step 1: Fetch seller's Stripe Connect account ───
                const { data: sellerProfile, error: profileError } = await supabase
                    .from('profiles')
                    .select('stripe_account_id, display_name')
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

                // ─── Step 2: Calculate transfer amount ───
                const totalAmountCents = Math.round((order.total_amount || 0) * 100)
                const platformFeeCents = Math.round((order.platform_fee || 0) * 100)
                const transferAmountCents = totalAmountCents - platformFeeCents

                if (transferAmountCents <= 0) {
                    console.warn(`[release-funds] Transfer amount for order ${order.id} is <= 0 (${transferAmountCents}). Skipping.`)
                    results.push({ orderId: order.id, status: 'skipped', error: 'Transfer amount is zero or negative' })
                    failed++
                    continue
                }

                // ─── Step 3: Execute Stripe Transfer ───
                console.log(`[release-funds] Transferring ${transferAmountCents} THB stang to ${sellerProfile.stripe_account_id} for order ${order.id}...`)

                // Stripe Idempotency-Key keyed on order.id closes two race windows:
                //   1. Transfer succeeds, but the subsequent DB update (line ~115)
                //      fails. Next cron tick sees stripe_payout_id IS NULL and
                //      retries — without an idempotency key, that would create a
                //      SECOND transfer. With this key, Stripe returns the original.
                //   2. Two concurrent cron invocations both pass the SELECT and
                //      both call transfers.create before either does the DB CAS.
                //      Stripe dedupes on the key and only one transfer is created.
                // Stripe stores idempotency keys for 24 hours; that's well within
                // any reasonable retry window for this job.
                const transfer = await stripe.transfers.create(
                    {
                        amount: transferAmountCents,
                        currency: 'thb',
                        destination: sellerProfile.stripe_account_id,
                        transfer_group: order.transfer_group || undefined,
                        metadata: {
                            order_id: order.id,
                            seller_id: order.seller_id,
                            release_type: 'auto_escrow',
                        },
                    },
                    {
                        idempotencyKey: `payout_${order.id}`,
                    }
                )

                console.log(`[release-funds] Stripe Transfer ${transfer.id} created for order ${order.id}`)

                // ─── Step 4: Update order record ───
                const { error: updateError } = await supabase
                    .from('orders')
                    .update({
                        escrow_status: 'released',
                        status: 'completed',
                        completed_at: new Date().toISOString(),
                        stripe_payout_id: transfer.id,
                    })
                    .eq('id', order.id)
                    .eq('escrow_status', 'held') // Double-check: only update if still held (race condition guard)

                if (updateError) {
                    console.error(`[release-funds] Failed to update order ${order.id} after transfer:`, updateError)
                    results.push({ orderId: order.id, status: 'transfer_ok_db_failed', error: updateError.message })
                    failed++
                    continue
                }

                console.log(`[release-funds] Successfully released funds for order ${order.id} → Transfer ${transfer.id}`)
                results.push({ orderId: order.id, status: 'success' })
                processed++

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

                            await courier.send({
                                message: {
                                    to: recipient,
                                    content: {
                                        title: "CardStreet: Payout Sent! 💸",
                                        body: `Your payout of ฿${(transferAmountCents / 100).toLocaleString()} for order ${order.id} has been successfully transferred to your Stripe account.`,
                                    },
                                    routing: { method: "all", channels },
                                    data: { orderId: order.id, type: 'payout_completed', amount: transferAmountCents / 100 }
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
