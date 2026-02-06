import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ShippingAddress {
    name: string
    phone: string
    address: string
    district: string
    state: string
    postcode: string
}

interface Parcel {
    weight: number
    width: number
    length: number
    height: number
}

interface ShippopPurchaseRequest {
    api_key: string
    email: string
    from: ShippingAddress
    to: ShippingAddress
    parcels: Parcel[]
    courier_code: string
}

interface ShippopResponse {
    success: boolean
    purchase_id: string
    tracking_code: string
    label_url: string
    courier_name: string
    tracking_url: string
}

serve(async (req) => {
    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        const { orderId } = await req.json()

        if (!orderId) {
            return new Response(
                JSON.stringify({ error: 'Order ID is required' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // Fetch order details with related data
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select(`
        *,
        buyer:profiles!buyer_id(display_name, email),
        seller:profiles!seller_id(display_name),
        listing:listings(card_data, price),
        shipping_address:shipping_addresses(*)
      `)
            .eq('id', orderId)
            .single()

        if (orderError) {
            console.error('Order fetch error:', orderError)
            throw new Error(`Failed to fetch order: ${orderError.message}`)
        }

        if (!order) {
            throw new Error('Order not found')
        }

        if (order.status !== 'paid') {
            throw new Error('Order must be paid before generating shipping label')
        }

        // Check if label already exists
        const { data: existingLabel } = await supabase
            .from('shipping_labels')
            .select('id')
            .eq('order_id', orderId)
            .single()

        if (existingLabel) {
            return new Response(
                JSON.stringify({ error: 'Shipping label already exists for this order' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // Prepare SHIPPOP API request
        const shippopRequest: ShippopPurchaseRequest = {
            api_key: Deno.env.get('SHIPPOP_API_KEY')!,
            email: Deno.env.get('SHIPPOP_EMAIL')!,
            from: {
                // TODO: Get seller's address from profile or settings
                name: order.seller.display_name || 'CardStreet Seller',
                phone: '0812345678', // TODO: From seller profile
                address: 'Store Address', // TODO: From seller profile
                district: 'District', // TODO: From seller profile
                state: 'Bangkok', // TODO: From seller profile
                postcode: '10100', // TODO: From seller profile
            },
            to: {
                name: order.shipping_address.recipient_name,
                phone: order.shipping_address.phone_number,
                address: `${order.shipping_address.address_line1}${order.shipping_address.address_line2 ? ', ' + order.shipping_address.address_line2 : ''}`,
                district: order.shipping_address.district,
                state: order.shipping_address.province,
                postcode: order.shipping_address.postal_code,
            },
            parcels: [{
                weight: 0.1, // TCG cards weight ~100g
                width: 10,
                length: 15,
                height: 1,
            }],
            courier_code: Deno.env.get('SHIPPOP_DEFAULT_COURIER') || 'THP', // Thailand Post
        }

        console.log('Calling SHIPPOP API with request:', JSON.stringify(shippopRequest, null, 2))

        // Call SHIPPOP API
        const shippopResponse = await fetch('https://api.shippop.com/v2/purchase/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(shippopRequest),
        })

        if (!shippopResponse.ok) {
            const errorText = await shippopResponse.text()
            console.error('SHIPPOP API error:', errorText)
            throw new Error(`SHIPPOP API error: ${shippopResponse.status} - ${errorText}`)
        }

        const shippopData: ShippopResponse = await shippopResponse.json()

        if (!shippopData.success) {
            throw new Error('SHIPPOP purchase failed')
        }

        console.log('SHIPPOP response:', JSON.stringify(shippopData, null, 2))

        // Store shipping label in database
        const { error: labelError } = await supabase
            .from('shipping_labels')
            .insert({
                order_id: orderId,
                tracking_number: shippopData.tracking_code,
                label_url: shippopData.label_url,
                carrier_name: shippopData.courier_name,
                shippop_purchase_id: shippopData.purchase_id,
                courier_tracking_url: shippopData.tracking_url,
                status: 'created',
            })

        if (labelError) {
            console.error('Label insert error:', labelError)
            throw new Error(`Failed to store shipping label: ${labelError.message}`)
        }

        // Update order status
        const { error: updateError } = await supabase
            .from('orders')
            .update({ status: 'label_generated' })
            .eq('id', orderId)

        if (updateError) {
            console.error('Order update error:', updateError)
            throw new Error(`Failed to update order: ${updateError.message}`)
        }

        return new Response(
            JSON.stringify({
                success: true,
                tracking_number: shippopData.tracking_code,
                label_url: shippopData.label_url,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            }
        )
    } catch (error) {
        console.error('Error in create-shipping-label:', error)
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
