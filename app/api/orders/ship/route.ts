import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createBooking, confirmOrder, getLabelUrl } from '@/lib/shippop'

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { orderId, trackingNumber, carrier } = await request.json()

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
        }

        // Verify ownership and get full order details
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single()

        if (orderError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        if (order.seller_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized to modify this order' }, { status: 403 })
        }

        if (order.status !== 'paid' && order.status !== 'label_generated') {
            return NextResponse.json({ error: 'Order cannot be shipped in current status' }, { status: 400 })
        }

        // Fetch Seller and Buyer profiles to build SHIPPOP required objects
        const { data: profiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', [order.buyer_id, order.seller_id])

        const sellerProfile = profiles?.find(p => p.id === order.seller_id)
        const buyerProfile = profiles?.find(p => p.id === order.buyer_id)

        // Fetch Listing for product data
        const { data: listing } = await supabase
            .from('listings')
            .select('*')
            .eq('id', order.listing_id)
            .single()

        // Default mock builder for addresses if users haven't populated them
        const buildAddress = (profile: any, fallbackName: string) => ({
            name: profile?.display_name || fallbackName,
            address: profile?.address || '123 Fake Street',
            district: profile?.district || 'Bang Kho Laem',
            state: profile?.state || 'Bangkok',
            province: profile?.province || 'Bangkok',
            postcode: profile?.postcode || '10120',
            tel: profile?.phone_number || '0812345678'
        });

        // SHIPPOP booking format
        const bookingRequest = [{
            from: buildAddress(sellerProfile, 'CardStreet Seller'),
            to: buildAddress(buyerProfile, 'CardStreet Buyer'),
            parcel: {
                name: "Standard Box",
                weight: 0.1,
                width: 10,
                length: 15,
                height: 5
            },
            product: {
                "0": {
                    product_code: listing?.card_id || 'UNKNOWN',
                    name: listing?.card_data?.name || 'Pokemon Card',
                    price: order.total_amount,
                    amount: 1,
                    weight: 0.1,
                    category: 'Trading Cards'
                }
            },
            courier_code: carrier === 'Thailand Post' ? 'EMST' : 'FLASH',
            cod_amount: 0
        }];

        // Execute Shippop API workflow
        let generatedLabelUrl = 'N/A';
        let shippopTracking = trackingNumber || '';
        let shippopPurchaseId: number = 0;

        // If no explicit tracking number was supplied, we generate one via Shippop
        if (!trackingNumber) {
            console.log("Creating SHIPPOP booking...");
            const bookingResult = await createBooking(bookingRequest);
            console.log("SHIPPOP Booking Response:", bookingResult);

            shippopPurchaseId = bookingResult.purchase_id;

            // The response tracking data dynamically indexes depending on how many parcels we sent...
            // e.g { data: { "0": { tracking_code: "XXX" } } }
            const parcelZero = bookingResult.data && bookingResult.data["0"] ? bookingResult.data["0"] : null;
            if (parcelZero) {
                shippopTracking = parcelZero.tracking_code;
            }

            console.log("Confirming SHIPPOP Order...", shippopPurchaseId);
            await confirmOrder(shippopPurchaseId);

            console.log("Fetching SHIPPOP Label...", shippopPurchaseId);
            const labelResult = await getLabelUrl(shippopPurchaseId, 'A4');
            console.log("SHIPPOP Label Response:", labelResult);
            if (labelResult.url) {
                generatedLabelUrl = labelResult.url;
            } else if (labelResult.data?.url) { // Sometimes nested in data
                generatedLabelUrl = labelResult.data.url;
            }
        }

        // Update the order status
        const { error: updateError } = await supabase
            .from('orders')
            .update({ status: 'shipped' })
            .eq('id', orderId)

        if (updateError) throw updateError

        // Upsert the shipping_labels record with final tracking and URLs
        const { error: labelError } = await supabase
            .from('shipping_labels')
            .upsert({
                order_id: orderId,
                tracking_number: shippopTracking,
                carrier_name: carrier || 'SHIPPOP Courier',
                status: 'in_transit',
                label_url: generatedLabelUrl
            }, { onConflict: 'order_id' })

        if (labelError) {
            console.error("Failed to insert shipping label info:", labelError)
        }

        // Fire Courier notifications asynchronously
        import('@/lib/courier').then(({ sendLabelGeneratedNotification, sendShippedNotification }) => {
            const trackingUrlOrNumber = shippopTracking || generatedLabelUrl;
            sendLabelGeneratedNotification(order.seller_id, order, generatedLabelUrl);
            sendShippedNotification(order.buyer_id, order, trackingUrlOrNumber);
        }).catch(e => console.error('Courier dynamic import error:', e));

        return NextResponse.json({
            success: true,
            tracking: shippopTracking,
            label: generatedLabelUrl
        })

    } catch (error: any) {
        console.error("SHIPPOP Integration Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
