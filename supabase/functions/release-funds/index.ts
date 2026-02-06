import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        console.log('Running funds release job...')

        // Find orders ready for fund release
        // Criteria: delivered, escrow held, and past the 48-hour release date
        const { data: orders, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'delivered')
            .eq('escrow_status', 'held')
            .lte('funds_release_at', new Date().toISOString())

        if (fetchError) {
            console.error('Error fetching orders:', fetchError)
            throw new Error('Failed to fetch orders for fund release')
        }

        if (!orders || orders.length === 0) {
            console.log('No orders ready for fund release')
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

        console.log(`Found ${orders.length} orders ready for fund release`)

        let processed = 0
        let failed = 0

        for (const order of orders) {
            try {
                console.log(`Processing order ${order.id}...`)

                // Release funds
                const { error: updateError } = await supabase
                    .from('orders')
                    .update({
                        escrow_status: 'released',
                        status: 'completed',
                        completed_at: new Date().toISOString(),
                    })
                    .eq('id', order.id)

                if (updateError) {
                    console.error(`Failed to update order ${order.id}:`, updateError)
                    failed++
                    continue
                }

                // TODO: Trigger actual payment to seller
                // This would integrate with your payment gateway (PromptPay, TrueMoney, PayPal)
                // Example:
                // await initiatePayment({
                //   sellerId: order.seller_id,
                //   amount: order.total_amount - order.platform_fee,
                //   reference: order.id
                // })

                console.log(`Successfully released funds for order ${order.id}`)
                processed++
            } catch (orderError) {
                console.error(`Error processing order ${order.id}:`, orderError)
                failed++
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                processed,
                failed,
                total: orders.length,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            }
        )
    } catch (error) {
        console.error('Error in release-funds:', error)
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
