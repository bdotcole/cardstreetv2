import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ShippopWebhookPayload {
    purchase_id: string
    tracking_code: string
    status: string
    courier_code: string
    timestamp: string
    signature?: string
}

serve(async (req) => {
    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        const webhookData: ShippopWebhookPayload = await req.json()

        console.log('Received SHIPPOP webhook:', JSON.stringify(webhookData, null, 2))

        // TODO: Verify webhook signature for security
        // const isValid = verifyShippopSignature(webhookData, req.headers.get('X-Shippop-Signature'))
        // if (!isValid) {
        //   return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })
        // }

        const { tracking_code, status } = webhookData

        if (!tracking_code || !status) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // Find shipping label by tracking number
        const { data: label, error: labelError } = await supabase
            .from('shipping_labels')
            .select(`
        *,
        order:orders(*)
      `)
            .eq('tracking_number', tracking_code)
            .single()

        if (labelError || !label) {
            console.error('Label not found:', labelError)
            return new Response(
                JSON.stringify({ error: 'Shipping label not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // Map SHIPPOP status to our status
        const statusMap: Record<string, string> = {
            'created': 'created',
            'pickup': 'picked_up',
            'in_transit': 'in_transit',
            'out_for_delivery': 'out_for_delivery',
            'delivered': 'delivered',
            'failed': 'failed',
            'cancelled': 'failed',
        }

        const mappedStatus = statusMap[status.toLowerCase()] || status.toLowerCase()

        // Update shipping label status
        const { error: updateLabelError } = await supabase
            .from('shipping_labels')
            .update({ status: mappedStatus })
            .eq('id', label.id)

        if (updateLabelError) {
            console.error('Failed to update label:', updateLabelError)
            throw new Error('Failed to update shipping label')
        }

        // Update order status based on shipping status
        let orderStatus = label.order.status

        if (mappedStatus === 'picked_up' && orderStatus === 'label_generated') {
            orderStatus = 'shipped'
        } else if (mappedStatus === 'in_transit' || mappedStatus === 'out_for_delivery') {
            orderStatus = 'in_transit'
        } else if (mappedStatus === 'delivered') {
            orderStatus = 'delivered'
        }

        const orderUpdate: any = { status: orderStatus }

        // If delivered, start 48-hour countdown for funds release
        if (mappedStatus === 'delivered') {
            const fundsReleaseDate = new Date()
            fundsReleaseDate.setHours(fundsReleaseDate.getHours() + 48)

            orderUpdate.delivered_at = new Date().toISOString()
            orderUpdate.funds_release_at = fundsReleaseDate.toISOString()

            console.log(`Order ${label.order_id} delivered. Funds will be released at ${fundsReleaseDate.toISOString()}`)
        }

        const { error: updateOrderError } = await supabase
            .from('orders')
            .update(orderUpdate)
            .eq('id', label.order_id)

        if (updateOrderError) {
            console.error('Failed to update order:', updateOrderError)
            throw new Error('Failed to update order status')
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: 'Webhook processed successfully',
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            }
        )
    } catch (error) {
        console.error('Error in shippop-webhook:', error)
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
