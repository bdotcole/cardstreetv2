import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendSoldNotification, sendOrderConfirmationNotification } from '@/lib/courier';

export async function POST(req: Request) {
    try {
        const { items, paymentMethod, paymentId, buyerId } = await req.json();

        if (!items || !items.length || !buyerId) {
            return NextResponse.json({ error: 'Missing required configuration' }, { status: 400 });
        }

        // We use the service role key because transferring inventory requires updating items that belong to other users
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const ordersToInsert: any[] = [];
        const listingIdsToUpdate: string[] = [];

        // Fetch seller profiles for dynamic fee computation
        const sellerIds = [...new Set(items.map((i: any) => i.sellerId))];
        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('id, role, partner_level')
            .in('id', sellerIds);

        const feeMap = new Map();
        if (sellerProfiles) {
            for (const profile of sellerProfiles) {
                let fee = 0.09; // Default 9%
                if (profile.role === 'partner') {
                    switch (profile.partner_level?.toLowerCase().replace(' ', '_')) {
                        case 'bronze': fee = 0.05; break;
                        case 'silver': fee = 0.045; break;
                        case 'gold': fee = 0.04; break;
                        case 'platinum': fee = 0.035; break;
                        case 'sapphire': fee = 0.03; break;
                        case 'ruby': fee = 0.0275; break;
                        case 'emerald': fee = 0.025; break;
                        case 'diamond': fee = 0.0225; break;
                        case 'pink_diamond': fee = 0.02; break;
                        case 'heart': fee = 0.02; break;
                        default: fee = 0.05; break; // Baseline partner rate
                    }
                }
                feeMap.set(profile.id, fee);
            }
        }

        // 1. Prepare Orders
        for (const item of items) {
            const feePercentage = feeMap.get(item.sellerId) || 0.09;
            ordersToInsert.push({
                listing_id: item.id,
                buyer_id: buyerId,
                seller_id: item.sellerId,
                status: 'paid', // Skip pending if we're hitting this after Stripe/PayPal success
                total_amount: item.price,
                platform_fee: item.price * feePercentage,
                escrow_status: 'held',
                payment_method: paymentMethod || 'credit_card',
                payment_id: paymentId || 'mock_payment_id',
            });
            listingIdsToUpdate.push(item.id);
        }

        // 2. Insert Orders
        const { data: insertedOrders, error: insertError } = await supabase
            .from('orders')
            .insert(ordersToInsert)
            .select();

        if (insertError) {
            console.error('Failed to create orders:', insertError);
            throw new Error('Failed to generate orders in database');
        }

        // Fire Courier notifications asynchronously but await them before Serverless timeout
        if (insertedOrders) {
            try {
                const notifications = insertedOrders.flatMap(order => [
                    sendSoldNotification(order.seller_id, order),
                    sendOrderConfirmationNotification(order.buyer_id, order)
                ]);

                await Promise.allSettled(notifications);
            } catch (e) {
                console.error('Courier notification error:', e);
                // We don't want notification failure to break the checkout flow
            }
        }

        // 3. Update Listings to 'sold'
        const { error: listingsUpdateError } = await supabase
            .from('listings')
            .update({ status: 'sold' })
            .in('id', listingIdsToUpdate);

        if (listingsUpdateError) {
            console.error('Failed to update listings:', listingsUpdateError);
            // Non-fatal but should be flagged
        }

        // 4. Transfer Inventory Models (from seller collection to buyer vault)
        // Find the buyer's default Vault (create one if missing)
        const { data: buyerCollections } = await supabase
            .from('collections')
            .select('id')
            .eq('user_id', buyerId)
            .limit(1);

        let targetCollectionId;
        if (!buyerCollections || buyerCollections.length === 0) {
            const { data: newCollection } = await supabase
                .from('collections')
                .insert({ user_id: buyerId, name: 'Main Vault', include_in_portfolio: true })
                .select()
                .single();
            targetCollectionId = newCollection.id;
        } else {
            targetCollectionId = buyerCollections[0].id;
        }

        // For each item, look up if a collection_item bound to this exact seller and card exists to transfer
        // Note: For a true marketplace, we need an exact mapping from listing -> collection_item to remove the specific asset.
        // As a bridge layer, we will simply insert a new collection item for the buyer.
        // A full inventory decrement loop would query `collection_items` for seller -> cardId -> limit 1 -> delete.
        for (const item of items) {
            // Give card to buyer
            await supabase.from('collection_items').insert({
                collection_id: targetCollectionId,
                card_id: item.cardId,
                card_data: item.card,
                quantity: 1,
                condition: item.condition,
                purchase_price: item.price
            });

            // Reclaim card from seller's collection
            // We search for a single instance of this card in the seller's folders
            const { data: sellerItems } = await supabase
                .from('collection_items')
                .select('id, collections!inner(user_id)')
                .eq('card_id', item.cardId)
                .eq('collections.user_id', item.sellerId)
                .limit(1);

            if (sellerItems && sellerItems.length > 0) {
                await supabase.from('collection_items').delete().eq('id', sellerItems[0].id);
            }
        }

        return NextResponse.json({ success: true });

    } catch (err: any) {
        console.error('Checkout Processing Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
