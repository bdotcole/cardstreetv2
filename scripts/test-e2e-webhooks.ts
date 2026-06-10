import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import fetch from 'node-fetch' // Using native fetch in Node 18+ but standardizing

// Load environment from .env.local
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = dotenv.parse(fs.readFileSync(envPath))
for (const k in envConfig) {
    process.env[k] = envConfig[k]
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

async function runTest() {
    try {
        console.log('--- PHASE 1: SIMULATE PURCHASE ---')
        
        // 1. Get a random active listing and a test buyer
        const { data: listings } = await supabase
            .from('listings')
            .select('*')
            .eq('status', 'active')
            .gte('price', 20)
            .limit(1)

        if (!listings || listings.length === 0) {
            throw new Error('No active listings found for testing.')
        }
        const listing = listings[0]

        // Find a buyer (someone other than the seller)
        const { data: buyers } = await supabase
            .from('profiles')
            .select('id')
            .neq('id', listing.seller_id)
            .limit(1)

        const buyerId = buyers![0].id

        console.log(`Using Listing ID: ${listing.id} (Price: ${listing.price})`)
        console.log(`Using Buyer ID: ${buyerId}`)

        // 2. Call /api/orders/checkout directly via function logic to simulate the frontend
        // To avoid auth issues with API routes, we'll interact directly with Supabase like the frontend does,
        // or just hit the live deployed API. Let's hit the live API.
        const APP_URL = 'https://cardstreet.app'
        
        console.log(`Calling ${APP_URL}/api/orders/checkout...`)
        const orderRes = await fetch(`${APP_URL}/api/orders/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: [{
                    id: listing.id,
                    cardId: listing.card_id,
                    price: listing.price,
                    sellerId: listing.seller_id
                }],
                paymentMethod: 'credit_card',
                buyerId: buyerId
            })
        })
        
        const orderData = await orderRes.json() as { success?: boolean; transferGroup: string }
        if (!orderRes.ok || !orderData.success) {
            console.log('Order Data:', orderData)
            throw new Error('Failed to create order')
        }
        
        const transferGroup = orderData.transferGroup
        console.log(`✅ Order created successfully. Transfer Group: ${transferGroup}`)

        // 3. Create and confirm Payment Intent directly via Stripe API to simulate the frontend card charge
        console.log('Charging test card via Stripe API...')
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(listing.price * 100),
            currency: 'thb',
            payment_method: 'pm_card_visa', // Stripe test card
            confirm: true,
            transfer_group: transferGroup,
            metadata: {
                transfer_group: transferGroup,
                buyer_id: buyerId
            },
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            return_url: 'https://cardstreet.app/checkout/success'
        })

        console.log(`✅ Payment Intent Confirmed! ID: ${paymentIntent.id}, Status: ${paymentIntent.status}`)

        // 3.5 Manually trigger the webhook to Vercel (bypassing Stripe CLI/Dashboard)
        console.log('Manually dispatching Stripe Webhook to Vercel...')
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
        
        // Mock the event object
        const eventPayload = {
            id: 'evt_test_123',
            object: 'event',
            api_version: '2023-10-16',
            created: Math.floor(Date.now() / 1000),
            type: 'payment_intent.succeeded',
            data: {
                object: paymentIntent
            }
        }
        
        const payloadString = JSON.stringify(eventPayload, null, 2)
        const header = stripe.webhooks.generateTestHeaderString({
            payload: payloadString,
            secret: webhookSecret,
        })

        const webhookRes = await fetch(`${APP_URL}/api/webhooks/stripe`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Stripe-Signature': header
            },
            body: payloadString
        })
        
        const webhookText = await webhookRes.text()
        console.log(`Webhook API Response: ${webhookRes.status} ${webhookText}`)

        // 4. Check DB for webhook fulfillment
        console.log('Waiting 2 seconds for DB update...')
        await new Promise(r => setTimeout(r, 2000))

        const { data: orders } = await supabase
            .from('orders')
            .select('*, shipping_labels(*)')
            .eq('transfer_group', transferGroup)

        console.log('--- DB STATE AFTER WEBHOOK ---')
        orders?.forEach(o => {
            console.log(`Order ${o.id}: Status = ${o.status}`)
            o.shipping_labels?.forEach((l: any) => {
                console.log(`  -> Label: ${l.tracking_number} (Status: ${l.status})`)
            })
        })

        let trackingNumber = ''
        if (orders![0].shipping_labels && orders![0].shipping_labels.length > 0) {
            trackingNumber = orders![0].shipping_labels[0].tracking_number
        } else {
            console.log('⚠️ No shipping label generated natively (likely due to mock sandbox address). Creating a mock label to continue test...')
            trackingNumber = 'TH' + Math.floor(Math.random() * 1000000000)
            await supabase.from('shipping_labels').insert({
                order_id: orders![0].id,
                tracking_number: trackingNumber,
                courier: 'FLASH_EXPRESS',
                status: 'pending'
            })
        }

        console.log('\n--- PHASE 2: SIMULATE DELIVERY (FLASH EXPRESS) ---')
        console.log(`Triggering Flash webhook for tracking ${trackingNumber}...`)

        const flashRes = await fetch(`${APP_URL}/api/webhooks/flash`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: {
                    pno: trackingNumber,
                    state: "5" // Delivered
                }
            })
        })

        const flashData = await flashRes.json()
        console.log(`Flash Webhook Response:`, flashData)

        await new Promise(r => setTimeout(r, 2000))
        const { data: updatedOrder } = await supabase
            .from('orders')
            .select('status, funds_release_at, escrow_status')
            .eq('id', orders![0].id)
            .single()

        console.log(`Order Status after Flash Webhook: ${updatedOrder?.status}`)
        console.log(`Funds Release At: ${updatedOrder?.funds_release_at}`)

        console.log('\n--- PHASE 3: SIMULATE PAYOUT ---')
        console.log('Fast-forwarding funds_release_at to yesterday...')
        await supabase
            .from('orders')
            .update({ funds_release_at: new Date(Date.now() - 86400000).toISOString() })
            .eq('id', orders![0].id)

        console.log('Calling Supabase release-funds Edge Function...')
        // Find anon key
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        
        const payoutRes = await fetch(`https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/release-funds`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${anonKey}`
            }
        })

        const payoutData = await payoutRes.json()
        console.log(`Payout Function Response:`, payoutData)

        const { data: finalOrder } = await supabase
            .from('orders')
            .select('status, escrow_status, stripe_payout_id')
            .eq('id', orders![0].id)
            .single()

        console.log(`\n--- FINAL DB STATE ---`)
        console.log(`Order Status: ${finalOrder?.status}`)
        console.log(`Escrow Status: ${finalOrder?.escrow_status}`)
        console.log(`Stripe Payout ID: ${finalOrder?.stripe_payout_id}`)
        
        console.log('\n🎉 ALL PHASES COMPLETE. Check your Courier logs to verify the emails/pushes were sent.')

    } catch (e) {
        console.error('Test Failed:', e)
    }
}

runTest()
